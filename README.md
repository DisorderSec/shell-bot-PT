# shell-bot-Português
Telegram bot que executa comandos e envia a saída ao vivo

Este é um bot de Telegram de shellrunner [Telegram bot][] totalmente funcional. 
Você manda um comando, ele o executa e publica a saída ao vivo. 
Você pode enviar a entrada ao comando respondendo às mensagens de saída.

É um exemplo bastante complexo, porque ele realmente aparece no comando como um terminal, interpreta as seqüências de escape e atualizará as mensagens se as suas linhas forem tocadas. 
Isso significa que programas interativos, como o wget, devem funcionar naturalmente, você deve ver a atualização da barra de status.

O bot também permite que os arquivos sejam carregados ou baixados, e também possui um editor de texto simples disponível por conveniência.

Aqui está um exemplo do bot executado para clonar um repositório:
![Basic tasks](http://i.imgur.com/Xxtoe4G.png)

Aqui está um exemplo do bot rodendo o alsamixer:

![Alsamixer with keypad](http://i.imgur.com/j8aXFLd.png)

Este bot demonstra uma grande parte da API do [Botgram][]'s

**Nota:** devido à integração apertada, a execução desse bot no Windows atualmente não é suportada.

## Instalação

Antes de usar isso, você deveria ter obtido um token de autenticação para o seu bot e conhecer a identificação numérica do seu usuário pessoal. Se você não sabe o que isso significa, consulte a [publicação][] para obter um guia passo a passo completo..

~~~
git clone https://github.com/botgram/shell-bot-PT.git && cd shell-bot-PT
rm -r node_modules/
apt-get install -y nodejs
npm install
curl -sL https://deb.nodesource.com/setup_6.x | sudo -E bash -
~~~

Para iniciar o bot:

~~~
node server
~~~

A primeira vez que você executá-lo, ele irá pedir-lhe algumas perguntas e criar o arquivo de configuração automaticamente  `config.json`. Você também pode gravá-lo manualmente, veja `config.example.json`.

Quando iniciado, ele imprimirá um  `Bot pronto.` quando estiver funcionando. Por conveniência, você pode querer falar com o BotFather e definir a lista de comando para os conteúdos de `commands.txt`.


## Autorização

Quando começou, o bot apenas aceita mensagens provenientes do seu usuário. Isto é por razões de segurança: você não deseja que pessoas arbitrárias emitam comandos para o seu computador!

Se você quiser permitir que outro usuário use o bot, use `/token` e dê a esse usuário o link resultante. Se você quiser usar este bot em um grupo,
`/token`você receberá uma mensagem para encaminhar para o grupo.

### Toda a tradução do shell-bot foi feita por [TransparentHat][]
[TransparentHat]: https://t.me/hostkilled
[Telegram bot]: https://core.telegram.org/bots
[Botgram]: https://botgram.js.org
[publicação]: https://jmendeth.com/blog/telegram-shell-bot/
