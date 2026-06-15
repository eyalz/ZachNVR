import React from 'react';
import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import LiveView from './pages/LiveView';
import Cameras from './pages/Cameras';
import Playback from './pages/Playback';
import Chat from './pages/Chat';
import './App.css';

export default function App() {
  return (
    <div className="app-shell">
      <nav className="sidebar">
        <div className="logo">
          <span className="logo-icon">📹</span>
          <span className="logo-text">ZachNVR</span>
        </div>
        <NavLink to="/" end className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
          <span>🎥</span> Live View
        </NavLink>
        <NavLink to="/cameras" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
          <span>📡</span> Cameras
        </NavLink>
        <NavLink to="/playback" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
          <span>🎞️</span> Playback
        </NavLink>
        <NavLink to="/chat" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
          <span>💬</span> Search
        </NavLink>
      </nav>
      <main className="main-content">
        <Routes>
          <Route path="/" element={<LiveView />} />
          <Route path="/cameras" element={<Cameras />} />
          <Route path="/playback" element={<Playback />} />
          <Route path="/chat" element={<Chat />} />
        </Routes>
      </main>
    </div>
  );
}
