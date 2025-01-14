// Variáveis principais
let pc; // RTCPeerConnection
let dc; // DataChannel
let assembledResponse = ""; // Para montar a resposta de texto completa
let audioChunks = []; // Para montar o áudio recebido

// Função para obter o token efêmero do backend
async function getEphemeralToken() {
  try {
    const response = await fetch("http://127.0.0.1:8000/session", {
      method: "POST",
    });

    if (!response.ok) {
      throw new Error("Falha ao obter o token efêmero.");
    }

    const data = await response.json();
    console.log("Token efêmero recebido do backend:", data);
    return data.client_secret.value; 
  } catch (error) {
    console.error("Erro ao obter token efêmero:", error);
    return null;
  }
}

// Função para inicializar a conexão WebRTC
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

    // Receber mensagens do canal de dados
    dc.addEventListener("message", (e) => {
      const event = JSON.parse(e.data);
      console.log("Mensagem recebida no canal de dados:", event);

      // Tratar eventos de texto
      if (event.type === "response.text.delta" && event.delta) {
        assembledResponse += event.delta;

        const existingBotMessage = document.querySelector(".message.bot p");
        if (existingBotMessage) {
          existingBotMessage.textContent = assembledResponse;
        } else {
          displayMessage(assembledResponse, "bot");
        }
      } else if (event.type === "response.done") {
        console.log("Resposta final recebida:", assembledResponse);
        displayMessage(assembledResponse, "bot");
        assembledResponse = ""; 
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

  // Verificar se já existe uma mensagem para o mesmo remetente
  let messageEl = document.querySelector(`.message.${sender}`);
  if (!messageEl) {
    // Criar novo elemento de mensagem se não existir
    messageEl = document.createElement("div");
    messageEl.classList.add("message", sender);
    messagesDiv.appendChild(messageEl);
  }

  // Atualizar ou adicionar texto
  if (text) {
    let textEl = messageEl.querySelector("p");
    if (!textEl) {
      // Criar parágrafo para o texto
      textEl = document.createElement("p");
      messageEl.appendChild(textEl);
    }
    textEl.textContent = text; // Atualizar o texto
  }

  // Adicionar áudio, se necessário
  if (audioUrl && !messageEl.querySelector("audio")) {
    const audioEl = document.createElement("audio");
    audioEl.src = audioUrl;
    audioEl.controls = true;
    messageEl.appendChild(audioEl);
  }

  // Garantir que o scroll vá para a última mensagem
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
