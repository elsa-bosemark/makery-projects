import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import MakeryStitch from './pages/MakeryStitch';
import './index.css';
createRoot(document.getElementById('root')!).render(<BrowserRouter basename={import.meta.env.BASE_URL}><MakeryStitch /></BrowserRouter>);
