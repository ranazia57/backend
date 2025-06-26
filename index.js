require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const faqs = require('./faqs.json');
const axios = require('axios');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const Fuse = require('fuse.js');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// === Fuse.js setup for FAQs ===
const fuse = new Fuse(faqs, {
  keys: ['question'],
  threshold: 0.4,
});

// === Chat Endpoint (Groq Llama 3 + FAQ Fuzzy Matching with Fuse.js) ===
app.post('/api/chat', async (req, res) => {
  const userMessage = req.body.message;

  // 1. Exact match
  const found = faqs.find(faq =>
    userMessage.toLowerCase().trim() === faq.question.toLowerCase().trim()
  );
  if (found) {
    return res.json({ answer: found.answer });
  }

  // 2. Fuse.js fuzzy match
  const results = fuse.search(userMessage);
  if (results.length > 0) {
    return res.json({ answer: results[0].item.answer });
  }

  // 3. Groq API fallback
  try {
    const groqRes = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama3-70b-8192',
        messages: [{ role: 'user', content: userMessage }],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        }
      }
    );
    const answer = groqRes.data.choices?.[0]?.message?.content || "Sorry, no answer found.";
    res.json({ answer });
  } catch (err) {
    console.error('Groq API Error:', err.response ? err.response.data : err.message);
    res.status(500).json({ answer: 'Sorry, something went wrong.' });
  }
});

// === Lead Capture Endpoint ===
app.post('/api/lead', async (req, res) => {
  const { name, email, message } = req.body;

  const doc = new PDFDocument();
  let buffers = [];
  doc.on('data', buffers.push.bind(buffers));
  doc.on('end', async () => {
    const pdfData = Buffer.concat(buffers);

    let transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    let mailOptions = {
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,
      subject: 'New Client Requirement (PDF)',
      text: `A new client has submitted their requirements.\n\nName: ${name}\nEmail: ${email}\nMessage: ${message}`,
      attachments: [
        {
          filename: 'client-requirement.pdf',
          content: pdfData
        }
      ]
    };

    try {
      await transporter.sendMail(mailOptions);
      res.json({ success: true, message: "PDF sent to your email!" });
    } catch (err) {
      console.error('Email Error:', err.response ? err.response.data : err.message);
      res.status(500).json({ success: false, message: "Email sending failed", error: err });
    }
  });

  doc.fontSize(20).text('Client Requirement', { align: 'center' });
  doc.moveDown();
  doc.fontSize(14).text(`Name: ${name}`);
  doc.text(`Email: ${email}`);
  doc.moveDown();
  doc.text('Message/Requirements:');
  doc.text(message);
  doc.end();
});

// ✅ THIS IS THE ONLY UPDATED LINE BELOW:
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
