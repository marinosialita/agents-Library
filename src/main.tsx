import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.tsx';
import './styles/index.css';
import { registerShareWorker } from './data/shared.ts';

registerShareWorker();

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
