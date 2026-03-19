import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { BetLabProvider } from './state/BetLabContext';
import './styles.css';

createRoot(document.getElementById('app')).render(
  <React.StrictMode>
    <BrowserRouter>
      <BetLabProvider>
        <App />
      </BetLabProvider>
    </BrowserRouter>
  </React.StrictMode>
);
