// FRAMED Game - Start proof server for preprod mode
// Runs only the proof server Docker container for preprod testing

import { DockerComposeEnvironment, Wait } from 'testcontainers';
import path from 'node:path';
import { currentDir } from './config.js';

const dockerEnv = new DockerComposeEnvironment(path.resolve(currentDir, '..'), 'proof-server.yml').withWaitStrategy(
  'skity-proof-server',
  Wait.forLogMessage('Actix runtime found; starting in Actix runtime', 1),
);

console.log('Starting proof server for preprod...');
const env = await dockerEnv.up();
console.log('Proof server running on http://localhost:6300');
console.log('Press Ctrl+C to stop');

// Keep the process alive
await new Promise(() => {});
