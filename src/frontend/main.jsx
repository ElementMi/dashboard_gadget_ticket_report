import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@forge/bridge';

function App() {
  const [status, setStatus] = useState('Calling backend...');

  useEffect(() => {
    invoke('ping')
      .then((res) => setStatus(res.message))
      .catch((err) => setStatus(`Backend error: ${err?.message ?? err}`));
  }, []);

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 16 }}>
      <h3>Element CFG Gadget</h3>
      <p>{status}</p>
    </div>
  );
}

createRoot(document.getElementById('app')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
