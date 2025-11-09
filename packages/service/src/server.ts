import express from 'express';
import path from 'node:path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createBridge } from '@rs485-homenet/core';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3000;

app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/bridge/start', (req, res) => {
  const { serialPath, baudRate = 9600, mqttUrl } = req.body ?? {};
  if (!serialPath || !mqttUrl) {
    res.status(400).json({ error: 'serialPath and mqttUrl are required' });
    return;
  }

  const bridge = createBridge({ serialPath, baudRate, mqttUrl });
  bridge.start();

  res.json({ status: 'started' });
});

const staticDir = path.resolve(__dirname, '../static');
app.use(express.static(staticDir));

app.get('*', (_req, res, next) => {
  const indexPath = path.join(staticDir, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      next();
    }
  });
});

app.listen(port, () => {
  console.log(`Service listening on port ${port}`);
});
