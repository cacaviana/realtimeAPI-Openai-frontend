
async function getEphemeralToken() {
    try {
      const response = await fetch("https://app-orion-dev.azurewebsites.net/session", {
        method: "POST",
      });
  
      if (!response.ok) {
        throw new Error("Falha ao obter o token efêmero.");
      }
  
      const data = await response.json();
      console.log("Token efêmero recebido do backend:", data);
      return data.client_secret.value; // Confirme o formato do JSON aqui
    } catch (error) {
      console.error("Erro ao obter token efêmero:", error);
      return null;
    }
  }
  
  async function setupWebRTC() {
    try {
      const token = await getEphemeralToken();
      if (!token) {
        console.error("Não foi possível obter o token efêmero.");
        return;
      }
  
      peerConnection = new RTCPeerConnection();
  
      // Criar o DataChannel e configurar
      dataChannel = peerConnection.createDataChannel("response");
      setupDataChannel();
  
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => {
        peerConnection.addTransceiver(track, { direction: "sendrecv" });
      });
  
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
  
      const response = await fetch("https://api.openai.com/v1/realtime", {
        method: "POST",
        body: offer.sdp,
        headers: {
          "Content-Type": "application/sdp",
          Authorization: `Bearer ${token}`,
        },
      });
  
      if (!response.ok) {
        const errorMessage = await response.text();
        throw new Error(`Falha ao enviar a oferta SDP: ${response.status} - ${errorMessage}`);
      }
  
      const answer = await response.text();
      await peerConnection.setRemoteDescription({ type: "answer", sdp: answer });
  
      console.log("Conexão WebRTC configurada com sucesso!");
    } catch (error) {
      console.error("Erro ao configurar WebRTC:", error);
    }
  }
  
  function setupDataChannel() {
    dataChannel.addEventListener("open", () => {
        console.log("Canal de dados aberto.");
        configureSession();
    });

    dataChannel.addEventListener("message", (event) => {
        const msg = JSON.parse(event.data);
        console.log("Mensagem recebida:", msg);

        if (msg.type === "response.audio_transcript.delta" && msg.delta) {
            handleTextDelta(msg.delta);
        }

        if (msg.type === "response.audio.delta" && msg.delta) {
            console.log("Chunk de áudio recebido:", msg.delta);
            audioChunks.push(msg.delta); // Acumular chunks de áudio
        }

        if (msg.type === "response.audio.done") {
            handleAudioDone(); // Processar o áudio completo
        }

        if (msg.type === "response.done") {
            console.log("Recebimento de texto e áudio concluído.");
        }
    });
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

    function handleAudioDelta(delta) {
        console.log("Áudio recebido (chunk Base64):", delta);
    
        const audioMessagesDiv = document.getElementById("audio-messages");
    
        // Converter o chunk Base64 para um Blob de áudio
        const audioBlob = new Blob([new Uint8Array(atob(delta).split("").map((c) => c.charCodeAt(0)))], {
            type: "audio/wav",
        });
    
        // Criar um URL para o Blob de áudio
        const audioUrl = URL.createObjectURL(audioBlob);
    
        // Criar um elemento de áudio para reprodução
        const audioElement = document.createElement("audio");
        audioElement.src = audioUrl;
        audioElement.controls = true;
    
        // Adicionar o elemento de áudio ao contêiner de mensagens de áudio
        audioMessagesDiv.appendChild(audioElement);
    
        // Rolagem automática
        audioMessagesDiv.scrollTop = audioMessagesDiv.scrollHeight;
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

    function handleAudioDone() {
        console.log("Áudio finalizado. Criando elemento de áudio.");

        const audioMessagesDiv = document.getElementById("audio-messages");

        // Verificar se recebemos os dados do áudio (atualize conforme necessário)
        if (!audioChunks || audioChunks.length === 0) {
            console.error("Nenhum áudio recebido.");
            return;
        }

        // Combinar todos os chunks em um Blob
        const audioBlob = new Blob(audioChunks.map(base64ToArrayBuffer), {
            type: "audio/wav",
        });

        // Criar URL para o áudio
        const audioUrl = URL.createObjectURL(audioBlob);

        // Criar elemento de áudio
        const audioElement = document.createElement("audio");
        audioElement.src = audioUrl;
        audioElement.controls = true;

        // Adicionar ao contêiner de áudio
        audioMessagesDiv.appendChild(audioElement);

        // Rolagem automática
        audioMessagesDiv.scrollTop = audioMessagesDiv.scrollHeight;

        // Limpar os chunks de áudio para a próxima mensagem
        audioChunks = [];
    }

    function base64ToArrayBuffer(base64) {
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }

  function handleDone() {
    console.log("Recebimento de texto e áudio concluído.");
    // Aqui você pode adicionar alguma ação final, como exibir uma mensagem de conclusão.
  }

  function configureSession() {
    const sessionConfig = {
      type: "session.update",
      session: {
        modalities: ["text", "audio"], // Modalidades suportadas
      },
    };
  
    dataChannel.send(JSON.stringify(sessionConfig));
    console.log("Configuração inicial enviada:", sessionConfig);
  }

  function startRecording() {
    const recordButton = document.getElementById("recordButton");
    recordButton.textContent = "Gravando... 🎙️";
    // Lógica para iniciar a gravação
    setTimeout(() => {
      recordButton.textContent = "🎤";
    }, 5000); // Simulação de 5 segundos
  }

  function sendMessage() {
    const input = document.getElementById("userInput"); // Captura o campo de entrada
    const message = input.value.trim(); // Remove espaços extras

    if (!message) {
        console.error("Mensagem vazia. Não será enviada.");
        return;
    }

    // Exibir a mensagem do usuário no chat
    const messagesDiv = document.getElementById("messages");
    const userMessage = document.createElement("div");
    userMessage.classList.add("message", "user"); // Classe para estilo
    userMessage.textContent = message;
    messagesDiv.appendChild(userMessage);

    // Rolagem automática
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    // Enviar a mensagem pelo DataChannel
    if (dataChannel && dataChannel.readyState === "open") {
        const payload = {
            type: "response.create",
            response: {
                modalities: ["text", "audio"], // Modalidades suportadas
                instructions: message, // Mensagem enviada
            },
        };

        dataChannel.send(JSON.stringify(payload)); // Enviar a mensagem para o servidor
        console.log("Mensagem enviada ao modelo:", payload);
    } else {
        console.error("Canal de dados não está conectado.");
    }

    // Limpar o campo de entrada
    input.value = "";
}

  
  
// Iniciar a configuração WebRTC
setupWebRTC();
