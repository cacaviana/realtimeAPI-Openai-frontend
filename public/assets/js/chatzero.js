let audioChunks = []; // Declaração global para armazenar os chunks de áudio
let peerConnection;
let dataChannel;

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
        return data.client_secret.value;
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

        // Processar deltas de texto
        if (msg.type === "response.audio_transcript.delta" && msg.delta) {
            handleTextDelta(msg.delta);
        }

        // Processar finalização do texto completo
        if (msg.type === "response.audio_transcript.done" && msg.transcript) {
            handleTranscriptDone(msg.transcript);
        }

        // Acumular chunks de áudio
        if (msg.type === "response.audio.delta" && msg.delta) {
            console.log("Chunk de áudio recebido:", msg.delta);
            audioChunks.push(msg.delta); // Acumular chunks de áudio
        }

        // Tratar eventos de áudio completos
        if (msg.type === "response.audio.done") {
            console.log("Áudio final recebido. Processando...");
            handleAudioDone();
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
    if (!audioChunks || audioChunks.length === 0) {
        console.error("Nenhum chunk de áudio recebido antes do 'audio.done'.");
        return;
    }

    try {
        // Converter os chunks acumulados para um Blob de áudio
        const audioBlob = new Blob(audioChunks.map(base64ToArrayBuffer), { type: "audio/wav" });

        // Criar um URL a partir do Blob
        const audioUrl = URL.createObjectURL(audioBlob);
        console.log("URL de áudio criado:", audioUrl);

        // Exibir ou manipular o áudio (neste caso, adicionando ao HTML)
        displayAudioMessage(audioUrl);

        // Limpar os chunks de áudio para a próxima mensagem
        audioChunks = [];
    } catch (error) {
        console.error("Erro ao processar o áudio:", error);
    }
}

function displayAudioMessage(audioUrl) {
    if (!audioUrl) {
        console.error("URL de áudio inválido ou ausente.");
        return;
    }

    const audioMessagesDiv = document.getElementById("audio-messages");

    if (!audioMessagesDiv) {
        console.error("Elemento de mensagens de áudio não encontrado no HTML.");
        return;
    }

    const audioElement = document.createElement("audio");
    audioElement.src = audioUrl;
    audioElement.controls = true;

    audioMessagesDiv.appendChild(audioElement);
    audioMessagesDiv.scrollTop = audioMessagesDiv.scrollHeight;
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

// Iniciar a configuração WebRTC
setupWebRTC();
