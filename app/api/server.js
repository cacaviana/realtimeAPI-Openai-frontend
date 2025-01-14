const express = require("express");
const fetch = require("node-fetch");
require("dotenv").config();

const app = express();
const PORT = 3000;

// Carrega a chave da API do ambiente
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.get("/session", async (req, res) => {
  try {
    const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview-2024-12-17",
        modalities: ["text", "audio"],
        instructions: "You are a friendly assistant.",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText });
    }

    const data = await response.json();
    res.json(data.client_secret); // Retorna o token efêmero
  } catch (error) {
    console.error("Erro ao gerar token efêmero:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
