'use client';
import { useState, useEffect, useRef } from 'react';

export default function LogViewer({ role }) {
  const [logs, setLogs] = useState('');
  const endRef = useRef(null);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await fetch(`/api/worker/logs?role=${role}`);
        const data = await res.json();
        if (data.success) {
          setLogs(data.logs);
        } else {
          setLogs(`[Empty or waiting for logs...]`);
        }
      } catch (err) {
        setLogs(`Error: ${err.message}`);
      }
    };
    fetchLogs();
    const intv = setInterval(fetchLogs, 2000);
    return () => clearInterval(intv);
  }, [role]);

  useEffect(() => {
    endRef.current?.scrollIntoView();
  }, [logs]);

  return (
    <div className="log-viewer">
      {logs || 'No logs available.'}
      <div ref={endRef} />
    </div>
  );
}
