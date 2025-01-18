// Configurações básicas
const baseUrl = "https://app-orion-dev.azurewebsites.net";
const baseUrlPinecone = "https://app-vectordb-ia.azurewebsites.net";
let pc = null; // RTCPeerConnection
let dc = null; // DataChannel
let localStream = null; // Stream do microfone
let mediaRecorder = null; // Gerenciador de gravação
let isWebRTCActive = false;

// Gerenciamento de áudio e mensagens
let audioChunks = [];
let assembledResponse = "";

// Funções de utilidade para UI
function createAudioElement(autoplay = true, controls = true) {
  const audioEl = document.createElement("audio");
  audioEl.autoplay = autoplay;
  audioEl.controls = controls;
  return audioEl;
}

// Obter token efêmero do backend
async function getEphemeralToken() {
  try {
    const response = await fetch(`${baseUrl}/session`, {
      method: "POST"
    });

    if (!response.ok) throw new Error("Falha ao obter token efêmero");

    const data = await response.json();
    console.log("Token efêmero recebido:", data);
    return data.client_secret.value;
  } catch (error) {
    console.error("Erro ao obter token:", error);
    return null;
  }
}

// Funções para manipulação de mensagens
function displayMessage(text, sender, audioUrl = null) {
  const messagesDiv = document.getElementById("messages");
  const messageEl = document.createElement("div");
  messageEl.classList.add("message", sender);

  if (text) {
    const textEl = document.createElement("p");
    textEl.textContent = text;
    messageEl.appendChild(textEl);
  }

  // Removemos esta parte que adiciona o elemento de áudio
  // if (audioUrl) {
  //   const audioEl = document.createElement("audio");
  //   audioEl.src = audioUrl;
  //   audioEl.controls = true;
  //   messageEl.appendChild(audioEl);
  // }

  messagesDiv.appendChild(messageEl);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Manipuladores de eventos de dados
function handleDataChannelMessage(event) {
  const msg = JSON.parse(event.data);
  console.log("Mensagem recebida:", msg);

  switch (msg.type) {
    case "response.audio_transcript.delta":
      if (msg.delta) handleTextDelta(msg.delta);
      break;
    case "response.audio_transcript.done":
      if (msg.transcript) handleTranscriptDone(msg.transcript);
      break;
    case "response.audio.delta":
      if (msg.delta) audioChunks.push(msg.delta);
      break;
    case "response.audio.done":
      handleAudioDone();
      break;
  }
}

function handleTextDelta(delta) {
  const messagesDiv = document.getElementById("messages");
  let lastBotMessage = messagesDiv.querySelector(".message.bot:last-child");

  if (!lastBotMessage) {
    lastBotMessage = document.createElement("div");
    lastBotMessage.classList.add("message", "bot");
    messagesDiv.appendChild(lastBotMessage);
  }

  lastBotMessage.textContent += delta;
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function handleTranscriptDone(transcript) {
  const messagesDiv = document.getElementById("messages");
  let lastBotMessage = messagesDiv.querySelector(".message.bot:last-child");

  if (!lastBotMessage) {
    lastBotMessage = document.createElement("div");
    lastBotMessage.classList.add("message", "bot");
    messagesDiv.appendChild(lastBotMessage);
  }

  lastBotMessage.textContent = transcript;
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Modificar a função handleAudioDone para não exibir o áudio
function handleAudioDone() {
  // O áudio ainda será processado, mas não será exibido
  const audioBlob = new Blob(audioChunks.map(base64ToArrayBuffer), { type: "audio/wav" });
  audioChunks = []; // Limpar os chunks de áudio

  // Não chamamos mais o displayMessage com o audioUrl
  // const audioUrl = URL.createObjectURL(audioBlob);
  // displayMessage(null, "bot", audioUrl);
}

// Funções para manipulação visual com a consulta no Pinecone
const visualFunctions = {
  changeBackgroundColor: ({ color }) => {
    document.body.style.backgroundColor = color;
    return { success: true, color };
  },

  changeTextColor: ({ color }) => {
    document.body.style.color = color;
    return { success: true, color };
  },

  changeButtonStyle: ({ size, color }) => {
    const buttons = document.querySelectorAll('button');
    buttons.forEach(button => {
      if (size) button.style.fontSize = size;
      if (color) button.style.backgroundColor = color;
    });
    return { success: true, size, color };
  },

  getPageHTML: () => {
    return {
      success: true,
      html: document.documentElement.outerHTML
    };
  },

  // Nova função para consultar o Pinecone
  queryProductInfo: async ({ query, metadata = {}, namespace = "MasterIADEV" }) => {
    try {
      const queryParams = new URLSearchParams({
        question: query,
        namespace: namespace
      });

      const response = await fetch(`${baseUrlPinecone}/openai/assistant/complete?${queryParams.toString()}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({})
      });

      if (!response.ok) {
        throw new Error(`Erro na API: ${response.status}`);
      }

      const data = await response.json();
      const content = data.assistant || "Não foi possível processar a resposta.";

      return {
        success: true,
        content: content,
        metadata: {
          review: data.review,
          data: data.data,
          text: data.text,
          timestamps: data.timestamps
        }
      };

    } catch (error) {
      console.error('Erro ao consultar o banco de dados:', error);
      return {
        success: false,
        error: 'Desculpe, não consegui acessar as informações no momento.'
      };
    }
  }
};

// Atualizar o manipulador de mensagens do canal de dados
// Modificar a função handleDataChannelMessage para melhor tratamento de erros
function handleDataChannelMessage(event) {
  try {
    const msg = JSON.parse(event.data);
    console.log("Mensagem recebida:", msg);

    switch (msg.type) {
      case "response.output_item.done":
        if (msg.item && msg.item.type === 'function_call' && msg.item.name === 'queryProductInfo') {
          // Verificar se existe arguments em vez de output
          const outputData = msg.item.arguments || msg.item.output;

          if (outputData) {
            try {
              const result = JSON.parse(outputData);
              if (result && result.content) {
                handleTextDelta(result.content);
                handleTranscriptDone(result.content);
              }
            } catch (error) {
              console.log("Usando outputData diretamente:", outputData);
              // Se não for um JSON válido, tentar usar o texto diretamente
              handleTextDelta(outputData);
              handleTranscriptDone(outputData);
            }
          } else {
            // Procurar por outros campos que possam conter a resposta
            const possibleResponse = msg.item.response ||
              (msg.response && msg.response.output) ||
              msg.item.output;

            if (possibleResponse) {
              handleTextDelta(possibleResponse);
              handleTranscriptDone(possibleResponse);
            }
          }
        }
        break;

      case "response.function_call_arguments.done":
        if (msg.name === 'queryProductInfo') {
          try {
            const args = msg.arguments ? JSON.parse(msg.arguments) : {};
            visualFunctions.queryProductInfo(args).then(result => {
              if (result.success && result.content) {
                handleTextDelta(result.content);
                handleTranscriptDone(result.content);

                if (dc && dc.readyState === "open") {
                  const response = {
                    type: 'conversation.item.create',
                    item: {
                      type: 'function_call_output',
                      call_id: msg.call_id,
                      output: JSON.stringify({
                        content: result.content,
                        success: true
                      })
                    }
                  };
                  dc.send(JSON.stringify(response));
                }
              }
            }).catch(error => {
              console.error('Erro na execução da função:', error);
              handleTextDelta("Desculpe, ocorreu um erro ao processar sua solicitação.");
            });
          } catch (error) {
            console.error("Erro ao processar argumentos:", error);
          }
        }
        break;

      case "response.audio_transcript.delta":
        if (msg.delta) handleTextDelta(msg.delta);
        break;

      case "response.audio_transcript.done":
        if (msg.transcript) handleTranscriptDone(msg.transcript);
        break;

      case "response.audio.delta":
        if (msg.delta) audioChunks.push(msg.delta);
        break;

      case "response.audio.done":
        handleAudioDone();
        break;

      default:
        console.log("Tipo de mensagem não processado:", msg.type);
    }
  } catch (error) {
    console.error("Erro ao processar mensagem:", error);
  }
};

// Função helper para debug
function logMessageStructure(msg) {
  console.log("Estrutura da mensagem recebida:");
  console.log("- Tipo:", msg.type);
  console.log("- Item:", msg.item);
  if (msg.item) {
    console.log("  - Tipo do item:", msg.item.type);
    console.log("  - Nome:", msg.item.name);
    console.log("  - Output:", msg.item.output);
    console.log("  - Arguments:", msg.item.arguments);
  }
  console.log("- Resposta completa:", msg);
};

// Adicionar função para reconexão do WebRTC
function reconnectWebRTC() {
  console.log("Tentando reconectar WebRTC...");
  if (!isWebRTCActive) {
    initWebRTC().then(() => {
      isWebRTCActive = true;
      console.log("Reconexão WebRTC bem-sucedida");
    }).catch(error => {
      console.error("Falha na reconexão:", error);
      setTimeout(reconnectWebRTC, 5000); // Tentar novamente em 5 segundos
    });
  }
}

// Configurar ferramentas disponíveis ao iniciar o canal de dados
function configureDataChannel() {
  if (!dc) return;

  const tools = {
    type: 'session.update',
    session: {
      modalities: ['text', 'audio'],
      tools: [
        {
          type: 'function',
          name: 'changeBackgroundColor',
          description: 'Muda a cor de fundo da página',
          parameters: {
            type: 'object',
            properties: {
              color: {
                type: 'string',
                description: 'Valor hexadecimal ou nome da cor'
              }
            }
          }
        },
        {
          type: 'function',
          name: 'changeTextColor',
          description: 'Muda a cor do texto da página',
          parameters: {
            type: 'object',
            properties: {
              color: {
                type: 'string',
                description: 'Valor hexadecimal ou nome da cor'
              }
            }
          }
        },
        {
          type: 'function',
          name: 'queryProductInfo',
          description: 'Busca informações sobre produtos e empresa no banco de dados',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Pergunta ou consulta do usuário'
              },
              metadata: {
                type: 'object',
                description: 'Metadados para filtro',
                default: { categoria: 'geral', tipo: 'consulta' }
              },
              namespace: {
                type: 'string',
                description: 'Namespace do Pinecone',
                default: 'MasterIADEV'
              }
            },
            required: ['query']
          }
        }
      ]
    }
  };

  dc.send(JSON.stringify(tools));
}

// Atualizar a função initWebRTC para configurar o canal de dados
async function initWebRTC() {
  try {
    const EPHEMERAL_KEY = await getEphemeralToken();
    if (!EPHEMERAL_KEY) {
      console.error("Não foi possível obter o token efêmero.");
      return;
    }

    // Criar conexão WebRTC
    pc = new RTCPeerConnection();

    // Configurar listener de estado da conexão ICE
    pc.oniceconnectionstatechange = function () {
      console.log("Estado da conexão ICE:", pc.iceConnectionState);
      if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
        console.log("Tentando reconectar...");
        setTimeout(() => initWebRTC(), 5000); // Tentar reconectar após 5 segundos
      }
    };

    // Configurar para receber o áudio remoto
    const audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    pc.ontrack = (e) => {
      audioEl.srcObject = e.streams[0];
    };

    // Capturar o áudio do microfone
    const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audioTrack = mediaStream.getTracks()[0];
    pc.addTrack(audioTrack, mediaStream);

    // Configurar canal de dados
    dc = pc.createDataChannel("oai-events");
    dc.onmessage = handleDataChannelMessage;
    dc.onopen = () => {
      console.log("Canal de dados aberto");
      configureDataChannel();
    };

    dc.onclose = () => {
      console.log("Canal de dados fechado");
    };

    dc.onerror = (error) => {
      console.error("Erro no canal de dados:", error);
    };

    // Criar e configurar oferta SDP
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpResponse = await fetch("https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17", {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${EPHEMERAL_KEY}`,
        "Content-Type": "application/sdp",
      },
    });

    if (!sdpResponse.ok) {
      throw new Error(`Erro na conexão com o endpoint Realtime: ${sdpResponse.statusText}`);
    }

    const answer = { type: "answer", sdp: await sdpResponse.text() };
    await pc.setRemoteDescription(answer);

    console.log("Conexão WebRTC estabelecida com sucesso!");
    isWebRTCActive = true;
  } catch (error) {
    console.error("Erro ao inicializar WebRTC:", error);
    isWebRTCActive = false;
  }
}

// Função para verificar e reconectar o canal de dados
function checkAndReconnectDataChannel() {
  if (!isWebRTCActive || !dc || dc.readyState !== "open") {
    console.log("Verificando necessidade de reconexão...");
    if (!pc || pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
      console.log("Iniciando reconexão...");
      initWebRTC();
    }
  }
}

// Configurar intervalo de verificação de conexão
setInterval(checkAndReconnectDataChannel, 10000); // Verificar a cada 10 segundos


// Função para exibir mensagens no chat
function displayMessage(text, sender, audioUrl = null) {
  const messagesDiv = document.getElementById("messages");
  const messageEl = document.createElement("div");
  messageEl.classList.add("message", sender);

  if (text) {
    const textEl = document.createElement("p");
    textEl.textContent = text;
    messageEl.appendChild(textEl);
  }

  if (audioUrl) {
    const audioEl = document.createElement("audio");
    audioEl.src = audioUrl;
    audioEl.controls = true;
    messageEl.appendChild(audioEl);
  }

  messagesDiv.appendChild(messageEl);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Conversor de base64 para ArrayBuffer
function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

function handleTextDelta(delta) {
  console.log("Texto recebido (delta):", delta);

  const messagesDiv = document.getElementById("messages");

  // Procurar o último texto do bot
  let lastBotMessage = messagesDiv.querySelector(".message.bot:last-child");

  // Se não existir, criar um novo elemento
  if (!lastBotMessage) {
    lastBotMessage = document.createElement("div");
    lastBotMessage.classList.add("message", "bot");
    messagesDiv.appendChild(lastBotMessage);
  }

  // Adicionar o delta ao texto existente sem apagar
  lastBotMessage.textContent += delta;

  // Rolagem automática
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function handleTranscriptDone(transcript) {
  console.log("Texto completo recebido (transcript):", transcript);

  const messagesDiv = document.getElementById("messages");

  // Procurar o último texto do bot
  let lastBotMessage = messagesDiv.querySelector(".message.bot:last-child");

  // Se não existir, criar um novo elemento
  if (!lastBotMessage) {
    lastBotMessage = document.createElement("div");
    lastBotMessage.classList.add("message", "bot");
    messagesDiv.appendChild(lastBotMessage);
  }

  // Substituir ou adicionar o texto final
  lastBotMessage.textContent = transcript;

  // Rolagem automática
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Função para enviar mensagem
function sendMessage() {
  const input = document.getElementById("userInput");
  const message = input.value.trim();

  if (message === "") {
    console.error("A mensagem está vazia.");
    return;
  }

  displayMessage(message, "user");

  if (dc && dc.readyState === "open") {
    const payload = {
      type: "response.create",
      response: {
        modalities: ["text", "audio"],
        instructions: message,
      },
    };
    dc.send(JSON.stringify(payload));
    console.log("Mensagem enviada ao modelo:", payload);
  } else {
    console.error("Canal de dados WebRTC não está conectado.");
  }

  input.value = "";
}

// Inicializar a conexão WebRTC ao carregar a página
initWebRTC();



// Aninimação da fala
document.addEventListener("mousemove", (event) => {
  const emoji = document.getElementById("emoji");
  const avatarContainer = document.querySelector(".avatar-container");

  // Posição do contêiner do avatar
  const rect = avatarContainer.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  // Calcular o ângulo de rotação baseado no mouse
  const deltaX = event.clientX - centerX;
  const deltaY = event.clientY - centerY;
  const angle = Math.atan2(deltaY, deltaX);

  // Atualizar a posição do emoji
  const maxOffset = 15; // Distância máxima que o emoji pode "olhar"
  const offsetX = Math.cos(angle) * maxOffset;
  const offsetY = Math.sin(angle) * maxOffset;

  // Aplicar transformação relativa ao centro
  emoji.style.transform = `translate(-50%, -50%) translate(${offsetX}px, ${offsetY}px)`;
});