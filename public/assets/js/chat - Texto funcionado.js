let pc; // RTCPeerConnection
let dc; // DataChannel
let assembledResponse = ""; // Para montar a resposta completa

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
    console.log("Token efêmero recebido do backend:", data); // Exibe o token no console
    return data.client_secret.value; // Retorna o valor do token efêmero
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

    // Configurar canal de dados
    dc = pc.createDataChannel("oai-events");

    // Capturar o áudio do microfone
    const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audioTrack = mediaStream.getTracks()[0]; // Obter a faixa de áudio
    pc.addTrack(audioTrack, mediaStream); // Adicionar a faixa ao PeerConnection

    // Configurar recepção de mensagens
    dc.addEventListener("message", (e) => {
      const event = JSON.parse(e.data);

      console.log("Mensagem recebida no canal de dados:", event);

      // Verificar o tipo de evento e montar a mensagem completa
      if (event.type === "response.text.delta" && event.delta) {
        // Adicionar texto parcial ao HTML
        assembledResponse += event.delta;

        // Atualizar o texto em tempo real no chat
        const existingBotMessage = document.querySelector(".message.bot p");
        if (existingBotMessage) {
          existingBotMessage.textContent = assembledResponse;
        } else {
          displayMessage(assembledResponse, "bot");
        }
      } else if (event.type === "response.done") {
        // Mensagem finalizada
        console.log("Resposta final recebida:", assembledResponse);

        // Certificar que a mensagem final foi atualizada no chat
        displayMessage(assembledResponse, "bot");
        assembledResponse = ""; // Limpar a resposta acumulada
      }
    });

    // Criar e configurar oferta SDP
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Fazer requisição ao endpoint Realtime
    const baseUrl = "https://api.openai.com/v1/realtime";
    const model = "gpt-4o-realtime-preview-2024-12-17";

    const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
      method: "POST",
      body: offer.sdp, // Enviar SDP gerado pelo WebRTC
      headers: {
        Authorization: `Bearer ${EPHEMERAL_KEY}`, // Token efêmero
        "Content-Type": "application/sdp", // Tipo de conteúdo correto
      },
    });

    if (!sdpResponse.ok) {
      throw new Error(
        `Erro na conexão com o endpoint Realtime: ${sdpResponse.statusText}`
      );
    }

    // Configurar SDP remoto
    const answer = {
      type: "answer",
      sdp: await sdpResponse.text(),
    };
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

  // Adicionar texto
  if (text) {
    const textEl = document.createElement("p");
    textEl.textContent = text;
    messageEl.appendChild(textEl);
  }

  // Adicionar áudio
  if (audioUrl) {
    const audioEl = document.createElement("audio");
    audioEl.src = audioUrl;
    audioEl.controls = true;
    messageEl.appendChild(audioEl);
  }

  messagesDiv.appendChild(messageEl);
  messagesDiv.scrollTop = messagesDiv.scrollHeight; // Rolar para a última mensagem
}

// Função para enviar mensagem
function sendMessage() {
  const input = document.getElementById("userInput");
  const message = input.value.trim();

  if (message === "") {
    console.error("A mensagem está vazia.");
    return;
  }

  // Exibir mensagem do usuário no chat
  displayMessage(message, "user");

  // Enviar mensagem ao modelo pelo canal de dados WebRTC
  if (dc && dc.readyState === "open") {
    const payload = {
      type: "response.create",
      response: {
        modalities: ["text"],
        instructions: message,
      },
    };
    dc.send(JSON.stringify(payload));
    console.log("Mensagem enviada ao modelo:", payload);
  } else {
    console.error("Canal de dados WebRTC não está conectado.");
  }

  // Limpar o campo de entrada
  input.value = "";
}

// Inicializar a conexão WebRTC ao carregar a página
initWebRTC();
