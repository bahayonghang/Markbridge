import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyUiPreferences, readUiPreferences } from './features/settings/ui-preferences';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('ROOT_NOT_FOUND');
const preferences = readUiPreferences();
applyUiPreferences(preferences, window.matchMedia('(prefers-color-scheme: dark)').matches);
createRoot(root).render(<StrictMode><App initialPreferences={preferences} /></StrictMode>);
