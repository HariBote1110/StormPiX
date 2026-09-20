import './ui/style.css';
import { mountApp } from './ui/app.ts';

const root = document.getElementById('app');
if (!root) throw new Error('#app が見つかりません');
mountApp(root);
