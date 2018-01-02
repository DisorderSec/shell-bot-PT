#!/usr/bin/env node
// Starts the bot, handles permissions and chat context,
// interprets commands and delegates the actual command
// running to a Command instance. When started, an owner
// ID should be given.

var path = require("path");
var fs = require("fs");
var botgram = require("botgram");
var escapeHtml = require("escape-html");
var utils = require("./lib/utils");
var Command = require("./lib/command").Command;
var Editor = require("./lib/editor").Editor;

var CONFIG_FILE = path.join(__dirname, "config.json");
try {
    var config = require(CONFIG_FILE);
} catch (e) {
    console.error("Não foi possível carregar o arquivo de configuração, iniciando o assistente..\n");
    require("./lib/wizard").configWizard({ configFile: CONFIG_FILE });
    return;
}

var bot = botgram(config.authToken);
var owner = config.owner;
var tokens = {};
var granted = {};
var contexts = {};
var defaultCwd = process.env.HOME || process.cwd();

var fileUploads = {};

bot.on("updateError", function (err) {
  console.error("Erro ao atualizar:", err);
});

bot.on("synced", function () {
  console.log("Bot pronto.");
});


function rootHook(msg, reply, next) {
  if (msg.queued) return;

  var id = msg.chat.id;
  var allowed = id === owner || granted[id];

  // If this message contains a token, check it
  if (!allowed && msg.command === "start" && Object.hasOwnProperty.call(tokens, msg.args())) {
    var token = tokens[msg.args()];
    delete tokens[msg.args()];
    granted[id] = true;
    allowed = true;

    // Notify owner
    // FIXME: reply to token message
    var contents = (msg.user ? "Usuário" : "Chat") + " <em>" + escapeHtml(msg.chat.name) + "</em>";
    if (msg.chat.username) contents += " (@" + escapeHtml(msg.chat.username) + ")";
    contents += " agora pode usar o bot. Para revogar, use:";
    reply.to(owner).html(contents).command("revoke", id);
  }

  // If chat is not allowed, but user is, use its context
  if (!allowed && (msg.from.id === owner || granted[msg.from.id])) {
    id = msg.from.id;
    allowed = true;
  }

  // Check that the chat is allowed
  if (!allowed) {
    if (msg.command === "start") reply.html("Não está autorizado a usar este bot.");
    return;
  }

  if (!contexts[id]) contexts[id] = {
    id: id,
    shell: utils.shells[0],
    env: utils.getSanitizedEnv(),
    cwd: defaultCwd,
    size: {columns: 40, rows: 20},
    silent: true,
    linkPreviews: false,
  };

  msg.context = contexts[id];
  next();
}
bot.all(rootHook);
bot.edited.all(rootHook);


// Replies
bot.message(function (msg, reply, next) {
  if (msg.reply === undefined || msg.reply.from.id !== this.get("id")) return next();
  if (msg.file)
    return handleDownload(msg, reply);
  if (msg.context.editor)
    return msg.context.editor.handleReply(msg);
  if (!msg.context.command)
    return reply.html("Nenhum comando está em execução.");
  msg.context.command.handleReply(msg);
});

// Edits
bot.edited.message(function (msg, reply, next) {
  if (msg.context.editor)
    return msg.context.editor.handleEdit(msg);
  next();
});

// Convenience command -- behaves as /run or /enter
// depending on whether a command is already running
bot.command("r", function (msg, reply, next) {
  // A little hackish, but it does show the power of
  // Botgram's fallthrough system!
  msg.command = msg.context.command ? "enter" : "run";
  next();
});

// Signal sending
bot.command("cancel", "kill", function (msg, reply, next) {
  var arg = msg.args(1)[0];
  if (!msg.context.command)
    return reply.html("Nenhum comando está em execução.");

  var group = msg.command === "cancel";
  var signal = group ? "SIGINT" : "SIGTERM";
  if (arg) signal = arg.trim().toUpperCase();
  if (signal.substring(0,3) !== "SIG") signal = "SIG" + signal;
  try {
    msg.context.command.sendSignal(signal, group);
  } catch (err) {
    reply.reply(msg).html("Não foi possível enviar o sinal.");
  }
});

// Input sending
bot.command("enter", "type", function (msg, reply, next) {
  var args = msg.args();
  if (!msg.context.command)
    return reply.html("Nenhum comando está em execução.");
  if (msg.command === "type" && !args) args = " ";
  msg.context.command.sendInput(args, msg.command === "type");
});
bot.command("control", function (msg, reply, next) {
  var arg = msg.args(1)[0];
  if (!msg.context.command)
    return reply.html("Nenhum comando está em execução.");
  if (!arg || !/^[a-zA-Z]$/i.test(arg))
    return reply.html("Use /control &lt;letter&gt; para enviar Control+letter para o processo.");
  var code = arg.toUpperCase().charCodeAt(0) - 0x40;
  msg.context.command.sendInput(String.fromCharCode(code), true);
});
bot.command("meta", function (msg, reply, next) {
  var arg = msg.args(1)[0];
  if (!msg.context.command)
    return reply.html("Nenhum comando está em execução.");
  if (!arg)
    return msg.context.command.toggleMeta();
  msg.context.command.toggleMeta(true);
  msg.context.command.sendInput(arg, true);
});
bot.command("end", function (msg, reply, next) {
  if (!msg.context.command)
    return reply.html("Nenhum comando está em execução.");
  msg.context.command.sendEof();
});

// Redraw
bot.command("redraw", function (msg, reply, next) {
  if (!msg.context.command)
    return reply.html("Nenhum comando está em execução.");
  msg.context.command.redraw();
});

// Command start
bot.command("run", function (msg, reply, next) {
  var args = msg.args();
  if (!args)
    return reply.html("Use /run &lt;command&gt; para executar algo.");

  if (msg.context.command) {
    var command = msg.context.command;
    return reply.text("Um comando já está sendo executado.");
  }

  if (msg.editor) msg.editor.detach();
  msg.editor = null;

  console.log("Chat «%s»: comando em execução «%s»", msg.chat.name, args);
  msg.context.command = new Command(reply, msg.context, args);
  msg.context.command.on("exit", function() {
    msg.context.command = null;
  });
});

// Editor start
bot.command("file", function (msg, reply, next) {
  var args = msg.args();
  if (!args)
    return reply.html("Use /file &lt;arquivo&gt; para visualizar ou editar um arquivo de texto.");

  if (msg.context.command) {
    var command = msg.context.command;
    return reply.reply(command.initialMessage.id || msg).text("Um comando está em execução.");
  }

  if (msg.editor) msg.editor.detach();
  msg.editor = null;

  try {
    var file = path.resolve(msg.context.cwd, args);
    msg.context.editor = new Editor(reply, file);
  } catch (e) {
    reply.html("Não é possível abrir o arquivo: %s", e.message);
  }
});

// Keypad
bot.command("keypad", function (msg, reply, next) {
  if (!msg.context.command)
    return reply.html("Nenhum comando está em execução..");
  try {
    msg.context.command.toggleKeypad();
  } catch (e) {
    reply.html("Não foi possível alternar o teclado.");
  }
});

// File upload / download
bot.command("upload", function (msg, reply, next) {
  var args = msg.args();
  if (!args)
    return reply.html("Use /upload &lt;arquivo&gt; e eu vou enviar para você");

  var file = path.resolve(msg.context.cwd, args);
  try {
    var stream = fs.createReadStream(file);
  } catch (e) {
    return reply.html("Couldn't open file: %s", e.message);
  }

  // Catch errors but do nothing, they'll be propagated to the handler below
  stream.on("error", function (e) {});

  reply.action("upload_document").document(stream).then(function (e, msg) {
    if (e)
      return reply.html("Não foi possível enviar o arquivo: %s", e.message);
    fileUploads[msg.id] = file;
  });
});
function handleDownload(msg, reply) {
  if (Object.hasOwnProperty.call(fileUploads, msg.reply.id))
    var file = fileUploads[msg.reply.id];
  else if (msg.context.lastDirMessageId == msg.reply.id)
    var file = path.join(msg.context.cwd, msg.filename || utils.constructFilename(msg));
  else
    return;

  try {
    var stream = fs.createWriteStream(file);
  } catch (e) {
    return reply.html("Não foi possível escrever o arquivo: %s", e.message);
  }
  bot.fileStream(msg.file, function (err, ostream) {
    if (err) throw err;
    reply.action("typing");
    ostream.pipe(stream);
    ostream.on("end", function () {
      reply.html("Arquivo escrito: %s", file);
    });
  });
}

// Status
bot.command("status", function (msg, reply, next) {
  var content = "", context = msg.context;

  // Running command
  if (context.editor) content += "Arquivo de edição: " + escapeHtml(context.editor.file) + "\n\n";
  else if (!context.command) content += "No command running.\n\n";
  else content += "Command running, PID "+context.command.pty.pid+".\n\n";

  // Chat settings
  content += "Shell: " + escapeHtml(context.shell) + "\n";
  content += "Tamanho: " + context.size.columns + "x" + context.size.rows + "\n";
  content += "Diretório: " + escapeHtml(context.cwd) + "\n";
  content += "Silêncio: " + (context.silent ? "Sim" : "Não") + "\n";
  content += "Previsualiza link: " + (context.linkPreviews ? "Sim" : "Não") + "\n";
  var uid = process.getuid(), gid = process.getgid();
  if (uid !== gid) uid = uid + "/" + gid;
  content += "UID/GID: " + uid + "\n";

  // Granted chats (msg.chat.id is intentional)
  if (msg.chat.id === owner) {
    var grantedIds = Object.keys(granted);
    if (grantedIds.length) {
      content += "\nChats concedidos:\n";
      content += grantedIds.map(function (id) { return id.toString(); }).join("\n");
    } else {
      content += "\nNão foi concedido nenhum chat. Use /grant ou /token para permitir que outro usuário use o bot.";
    }
  }

  if (context.command) reply.reply(context.command.initialMessage.id);
  reply.html(content);
});

// Settings: Shell
bot.command("shell", function (msg, reply, next) {
  var arg = msg.args(1)[0];
  if (arg) {
    if (msg.context.command) {
      var command = msg.context.command;
      return reply.reply(command.initialMessage.id || msg).html("Não é possível alterar o shell enquanto um comando está sendo executado.");
    }
    try {
      var shell = utils.resolveShell(arg);
      msg.context.shell = shell;
      reply.html("Shell mudado.");
    } catch (err) {
      reply.html("Não foi possível alterar o shell.");
    }
  } else {
    var shell = msg.context.shell;
    var otherShells = utils.shells.slice(0);
    var idx = otherShells.indexOf(shell);
    if (idx !== -1) otherShells.splice(idx, 1);

    var content = "Shell atual: " + escapeHtml(shell);
    if (otherShells.length)
      content += "\n\nOutros shells:\n" + otherShells.map(escapeHtml).join("\n");
    reply.html(content);
  }
});

// Settings: Working dir
bot.command("cd", function (msg, reply, next) {
  var arg = msg.args(1)[0];
  if (arg) {
    if (msg.context.command) {
      var command = msg.context.command;
      return reply.reply(command.initialMessage.id || msg).html("Não é possível alterar o diretório enquanto um comando está sendo executado.");
    }
    var newdir = path.resolve(msg.context.cwd, arg);
    try {
      fs.readdirSync(newdir);
      msg.context.cwd = newdir;
    } catch (err) {
      return reply.html("%s", err);
    }
  }

  reply.html("Agora em: %s", msg.context.cwd).then().then(function (m) {
    msg.context.lastDirMessageId = m.id;
  });
});

// Settings: Environment
bot.command("env", function (msg, reply, next) {
  var env = msg.context.env, key = msg.args();
  if (!key)
    return reply.reply(msg).html("Use %s para ver o valor de uma variável, ou %s para alterá-la.", "/env <name>", "/env <name>=<value>");

  var idx = key.indexOf("=");
  if (idx === -1) idx = key.indexOf(" ");

  if (idx !== -1) {
    if (msg.context.command) {
      var command = msg.context.command;
      return reply.reply(command.initialMessage.id || msg).html("Não é possível alterar o ambiente enquanto um comando está sendo executado.");
    }

    var value = key.substring(idx + 1);
    key = key.substring(0, idx).trim().replace(/\s+/g, " ");
    if (value.length) env[key] = value;
    else delete env[key];
  }

  reply.reply(msg).text(printKey(key));

  function printKey(k) {
    if (Object.hasOwnProperty.call(env, k))
      return k + "=" + JSON.stringify(env[k]);
    return k + " unset";
  }
});

// Settings: Size
bot.command("resize", function (msg, reply, next) {
  var arg = msg.args(1)[0];
  var match = /(\d+)\s*((\sby\s)|x|\s|,|;)\s*(\d+)/i.exec(arg.trim());
  if (match) var columns = parseInt(match[1]), rows = parseInt(match[4]);
  if (!columns || !rows)
    return reply.text("Use /resize <columns> <rows> para redimensionar o terminal.");

  msg.context.size = { columns: columns, rows: rows };
  if (msg.context.command) msg.context.command.resize(msg.context.size);
  reply.reply(msg).html("Terminal redimensionado.");
});

// Settings: Silent
bot.command("setsilent", function (msg, reply, next) {
  var arg = utils.resolveBoolean(msg.args());
  if (arg === null)
    return reply.html("Use /setsilent [yes|no] para controlar se o novo resultado do comando será enviado silenciosamente.");

  msg.context.silent = arg;
  if (msg.context.command) msg.context.command.setSilent(arg);
  reply.html("A saída " + (arg ? "" : "não ") + "será enviado silenciosamente.");
});

// Settings: Link previews
bot.command("setlinkpreviews", function (msg, reply, next) {
  var arg = utils.resolveBoolean(msg.args());
  if (arg === null)
    return reply.html("Use /setlinkpreviews [yes|no] para controlar se os links no resultado são expandidos..");

  msg.context.linkPreviews = arg;
  if (msg.context.command) msg.context.command.setLinkPreviews(arg);
  reply.html("Os links na saída " + (arg ? "" : "não ") + "serão expandidos.");
});

// Settings: Other chat access
bot.command("grant", "revoke", function (msg, reply, next) {
  if (msg.context.id !== owner) return;
  var arg = msg.args(1)[0], id = parseInt(arg);
  if (!arg || isNaN(id))
    return reply.html("Use %s ou %s para controlar se o usuário com essa ID pode usar este bot.", "/grant <id>", "/revoke <id>");
  reply.reply(msg);
  if (msg.command === "grant") {
    granted[id] = true;
    reply.html("O usuário %s agora pode usar este bot. Use /revoke para desfazer.", id);
  } else {
    if (contexts[id] && contexts[id].command)
      return reply.html("Não foi possível remover usuários específicos porque um comando está sendo executado.");
    delete granted[id];
    delete contexts[id];
    reply.html("Usuário %s foi revogado.", id);
  }
});
bot.command("token", function (msg, reply, next) {
  if (msg.context.id !== owner) return;
  var token = utils.generateToken();
  tokens[token] = true;
  reply.disablePreview().html("Um token de acesso único gerado. O seguinte link pode ser usado para obter acesso ao bot:\n%s\n Ou enviando-me isso:", bot.link(token));
  reply.command(true, "start", token);
});

// Welcome message, help
bot.command("start", function (msg, reply, next) {
  if (msg.args() && msg.context.id === owner && Object.hasOwnProperty.call(tokens, msg.args())) {
    reply.html("Você já estava autenticado; o token foi revogado.");
  } else {
    reply.html("Bem vindo! Use /run para executar comandos e responda minhas mensagens para enviar a entrada. /help para mais informações.");
  }
});

bot.command("help", function (msg, reply, next) {
  reply.html(
    "Use /run &lt;comando&gt; e eu vou executá-lo para você. Enquanto ele está sendo executado, você pode: \n" +
    "\n" +
    "‣ Responda a uma das minhas mensagens para enviar a entrada ao comando ou use /enter.\n" +
    "‣ Use /end para enviar um EOF (Ctrl+D) para o comando.\n" +
    "‣ Use /cancel para enviar SIGINT (Ctrl+C) para o grupo de processos, ou o sinal que você escolheu.\n" +
    "‣ Use /kill para enviar SIGTERM para o processo raiz, ou o sinal que você escolher.\n" + 
    "‣ Para aplicações gráficas, use /redraw para forçar uma repetição da tela.\n" +
    "‣ Use /type ou /control para pressionar as teclas, /meta para enviar a próxima chave com Alt, ou /keypad para mostrar um teclado para chaves especiais.\n" + 
    "\n" +
    "Você pode ver o status e as configurações atuais para este bate-papo com /status. Use /env para " +
    "manipular o ambiente, /cd para altere o diretório atual, /shell para ver ou " +
    "altere o shell usado para executar comandos e /resize para alterar o tamanho do terminal.\n" +
    "\n" +
    "Por padrão, as mensagens de saída são enviadas silenciosamente (sem som) e os links não são expandidos. " +
    "Isso pode ser alterado através de /setsilent e /setlinkpreviews. Nota: links são " +
    "nunca expandiu em linhas de status.\n" +
    "\n" +
    "<em>Características adicionais</em>\n" +
    "\n" +
    "Use /upload &lt;arquivo&gt; e vou enviar esse arquivo para você. Se você responder a essa " +
    "mensagem enviando-me um arquivo, vou substituí-lo com o seu.\n" +
    "\n" +
    "Você também pode usar o /file &lt;arquivo&gt; para exibir o conteúdo do arquivo como um texto " +
    "mensagem. Isso também permite que você edite o arquivo, mas você tem que saber como ...\n" +
    "<em>Tradução por </em><pre>@TransparentHat</pre>\n"
  );
});

// FIXME: add inline bot capabilities!
// FIXME: possible feature: restrict chats to UIDs
// FIXME: persistence
// FIXME: shape messages so we don't hit limits, and react correctly when we do


bot.command(function (msg, reply, next) {
  reply.reply(msg).text("Comando inválido.");
});
