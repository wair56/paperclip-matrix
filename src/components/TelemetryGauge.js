'use client';

export default function TelemetryGauge({ label, value, color }) {
  const pct = parseFloat(value) || 0;
  return (
    <div className="telemetry-gauge">
      <div className="telemetry-gauge__label">{label}</div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${Math.min(pct, 100)}%`, background: color }}></div>
      </div>
      <div className="telemetry-gauge__value">
        {value}<span className="telemetry-gauge__unit">%</span>
      </div>
    </div>
  );
}
