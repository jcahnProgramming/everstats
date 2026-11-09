import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Load order from the design handoff (design/v1/README.md): fonts → tokens → components; then the app's additions.
import './theme/fonts.css';
import './theme/tokens.css';
import './theme/components.css';
import './theme/badges.css';
import './theme/guild-badges.css';
import './theme/card-maker.css';
import './theme/collections.css';
import './theme/app.css';
import './pages/pages.css';
import { App } from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
