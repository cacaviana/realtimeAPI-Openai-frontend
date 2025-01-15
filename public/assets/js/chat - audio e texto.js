// Configurações básicas
const baseUrl = "https://app-orion-dev.azurewebsites.net";
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

// Funções para manipulação visual
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
  }
};

// Atualizar o manipulador de mensagens do canal de dados
function handleDataChannelMessage(event) {
  const msg = JSON.parse(event.data);
  console.log("Mensagem recebida:", msg);

  // Adicionar manipulação de chamadas de função
  if (msg.type === 'response.function_call_arguments.done') {
    const fn = visualFunctions[msg.name];
    if (fn) {
      try {
        const args = JSON.parse(msg.arguments);
        const result = fn(args);

        // Enviar resultado de volta
        const response = {
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: msg.call_id,
            output: JSON.stringify(result)
          }
        };
        dc.send(JSON.stringify(response));
      } catch (error) {
        console.error("Erro ao executar função:", error);
      }
    }
  }

  // Manter os manipuladores existentes
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
          name: 'changeButtonStyle',
          description: 'Muda o estilo dos botões',
          parameters: {
            type: 'object',
            properties: {
              size: {
                type: 'string',
                description: 'Tamanho da fonte (ex: "16px" ou "1em")'
              },
              color: {
                type: 'string',
                description: 'Cor de fundo do botão'
              }
            }
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

    // Receber mensagens do canal de dados
    dc.addEventListener("message", (e) => {
      const event = JSON.parse(e.data);
      console.log("Mensagem recebida no canal de dados:", event);


      // Processar deltas de texto
      if (event.type === "response.audio_transcript.delta" && event.delta) {
        handleTextDelta(event.delta);
      }

      // Processar finalização do texto completo
      if (event.type === "response.audio_transcript.done" && event.transcript) {
        handleTranscriptDone(event.transcript);
      }

      // Tratar eventos de áudio
      if (event.type === "response.audio.delta" && event.delta) {
        audioChunks.push(event.delta);
      } else if (event.type === "response.audio.done") {
        console.log("Áudio final recebido");
        const audioBlob = new Blob(audioChunks.map(base64ToArrayBuffer), { type: "audio/wav" });
        const audioUrl = URL.createObjectURL(audioBlob);
        displayMessage(null, "bot", audioUrl);
        audioChunks = [];
      }
    });

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
  } catch (error) {
    console.error("Erro ao inicializar WebRTC:", error);
  }
}

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