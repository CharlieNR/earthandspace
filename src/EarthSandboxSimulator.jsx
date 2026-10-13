import React, { useEffect, useMemo, useRef, useState } from 'react';
import './EarthSandboxSimulator.css';

const SCENARIOS = [
  { id: 'fall', name: 'Feather vs ball', tag: 'Gravity + drag', intro: 'Drop two objects together. Change gravity and air resistance to see why a feather and a ball fall differently.' },
  { id: 'projectile', name: 'Projectile range', tag: 'Motion', intro: 'Launch a ball at different speeds and angles. Compare its range with and without drag.' },
  { id: 'orbit', name: 'Orbit laboratory', tag: 'Gravity + velocity', intro: 'Change a satellite’s speed and the central body’s gravity to explore stable, low and escape trajectories.' },
  { id: 'earth', name: 'Build an Earth', tag: 'Planet editor', intro: 'Add, move and remove continents anywhere on a simple world map. Change gravity, rotation and atmosphere.' },
  { id: 'impact', name: 'Impact experiment', tag: 'Energy', intro: 'Change an impactor’s mass and speed and compare its kinetic energy. This is a visualised estimate, not a geological forecast.' },
  { id: 'atmosphere', name: 'Atmosphere lab', tag: 'Air resistance', intro: 'Explore how air density, drag and wind affect a moving object.' },
];

const INITIAL_CONTINENTS = [
  { id: 'na', name: 'North America', x: 0.235, y: 0.31, sx: 0.19, sy: 0.23, points: [[-0.45,-0.08],[-0.31,-0.38],[-0.03,-0.46],[0.27,-0.26],[0.39,-0.05],[0.2,0.12],[0.1,0.37],[-0.1,0.46],[-0.24,0.19],[-0.42,0.1]] },
  { id: 'sa', name: 'South America', x: 0.32, y: 0.64, sx: 0.095, sy: 0.25, points: [[-0.36,-0.48],[0.14,-0.44],[0.4,-0.15],[0.2,0.15],[0.1,0.42],[-0.08,0.5],[-0.24,0.18],[-0.4,-0.13]] },
  { id: 'eurasia', name: 'Europe & Asia', x: 0.63, y: 0.31, sx: 0.31, sy: 0.22, points: [[-0.48,-0.24],[-0.24,-0.42],[0.08,-0.38],[0.35,-0.43],[0.49,-0.18],[0.42,0.12],[0.17,0.27],[-0.05,0.18],[-0.22,0.37],[-0.43,0.16]] },
  { id: 'af', name: 'Africa', x: 0.535, y: 0.59, sx: 0.12, sy: 0.25, points: [[-0.36,-0.37],[0.13,-0.46],[0.4,-0.17],[0.23,0.19],[0.04,0.49],[-0.18,0.34],[-0.39,-0.02]] },
  { id: 'au', name: 'Australia', x: 0.79, y: 0.72, sx: 0.12, sy: 0.105, points: [[-0.42,-0.08],[-0.18,-0.38],[0.18,-0.33],[0.43,-0.05],[0.24,0.32],[-0.13,0.39],[-0.4,0.16]] },
  { id: 'an', name: 'Antarctica', x: 0.5, y: 0.94, sx: 0.37, sy: 0.065, points: [[-0.5,-0.1],[-0.3,-0.5],[0.12,-0.4],[0.5,-0.12],[0.3,0.45],[-0.2,0.5]] },
];

const PRESETS = {
  fall: { gravity: 9.81, drag: 0.48, density: 1.225, wind: 0, speed: 0, angle: 45, mass: 0.003, radius: 0.12, rotation: 24 },
  projectile: { gravity: 9.81, drag: 0.12, density: 1.225, wind: 0, speed: 28, angle: 42, mass: 1, radius: 0.12, rotation: 24 },
  orbit: { gravity: 9.81, drag: 0, density: 0, wind: 0, speed: 7.9, angle: 90, mass: 1, radius: 0.12, rotation: 24 },
  earth: { gravity: 9.81, drag: 0.48, density: 1.225, wind: 0, speed: 0, angle: 45, mass: 1, radius: 0.12, rotation: 24 },
  impact: { gravity: 9.81, drag: 0.08, density: 1.225, wind: 0, speed: 18, angle: 25, mass: 500, radius: 0.8, rotation: 24 },
  atmosphere: { gravity: 9.81, drag: 0.8, density: 1.225, wind: 8, speed: 24, angle: 15, mass: 1, radius: 0.12, rotation: 24 },
};

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function Slider({ label, value, min, max, step, unit, onChange, format }) {
  return <label className="sandbox-slider">
    <span className="sandbox-slider-heading"><span>{label}</span><strong>{format ? format(value) : Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}{unit || ''}</strong></span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    <span className="sandbox-slider-limits"><small>{min}{unit || ''}</small><small>{max}{unit || ''}</small></span>
  </label>;
}

export default function EarthSandboxSimulator({ onHome, onOpenTerminal, terminal }) {
  const canvasRef = useRef(null);
  const frameRef = useRef(null);
  const pointerRef = useRef(null);
  const simulationRef = useRef({ t: 0, objects: [], trails: [], last: 0, running: false });
  const [scenarioId, setScenarioId] = useState('fall');
  const [settings, setSettings] = useState(PRESETS.fall);
  const [running, setRunning] = useState(false);
  const [resetTick, setResetTick] = useState(0);
  const [selectedObject, setSelectedObject] = useState('feather');
  const [continents, setContinents] = useState(INITIAL_CONTINENTS);
  const [selectedContinent, setSelectedContinent] = useState('af');
  const [mapTool, setMapTool] = useState('select');
  const [customName, setCustomName] = useState('New continent');
  const [result, setResult] = useState('Ready');
  const [showTrails, setShowTrails] = useState(true);
  const [showGrid, setShowGrid] = useState(true);

  const scenario = useMemo(() => SCENARIOS.find((item) => item.id === scenarioId) || SCENARIOS[0], [scenarioId]);
  const updateSetting = (key, value) => setSettings((current) => ({ ...current, [key]: value }));

  const changeScenario = (id) => {
    setScenarioId(id);
    setSettings({ ...PRESETS[id] });
    setRunning(false);
    setResult('Ready');
    setResetTick((tick) => tick + 1);
  };

  const reset = () => {
    setRunning(false);
    setResult('Reset');
    setResetTick((tick) => tick + 1);
  };

  useEffect(() => {
    simulationRef.current = { t: 0, objects: [], trails: [], last: 0, running: false };
  }, [scenarioId, resetTick, settings.gravity, settings.drag, settings.density, settings.wind, settings.speed, settings.angle, settings.mass, settings.radius, settings.angle, settings.rotation]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    let lastTime = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);

    const worldPoint = (x, y, w, h) => ({ x: x * w, y: y * h });
    const drawGrid = (w, h) => {
      if (!showGrid) return;
      ctx.strokeStyle = 'rgba(156, 204, 190, 0.10)';
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 34) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y < h; y += 34) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    };
    const drawContinent = (land, w, h, selected) => {
      const cx = land.x * w;
      const cy = land.y * h;
      ctx.beginPath();
      land.points.forEach((point, index) => {
        const x = cx + point[0] * land.sx * w;
        const y = cy + point[1] * land.sy * h;
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = selected ? '#a9edb4' : '#5abf8b';
      ctx.strokeStyle = selected ? '#efffca' : '#a0edbc';
      ctx.lineWidth = selected ? 2.2 : 1.1;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(6, 30, 23, .7)';
      ctx.font = '600 10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(land.name, cx, cy + 3);
      if (selected) {
        ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#f4d38b'; ctx.fill();
      }
    };

    const drawEarth = (w, h) => {
      const gradient = ctx.createLinearGradient(0, 0, 0, h);
      gradient.addColorStop(0, '#092c46'); gradient.addColorStop(1, '#061724');
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
      drawGrid(w, h);
      ctx.strokeStyle = 'rgba(122, 189, 220, .22)';
      for (let i = 1; i < 6; i++) { ctx.beginPath(); ctx.moveTo(0, h * i / 6); ctx.lineTo(w, h * i / 6); ctx.stroke(); }
      for (let i = 1; i < 12; i++) { ctx.beginPath(); ctx.moveTo(w * i / 12, 0); ctx.lineTo(w * i / 12, h); ctx.stroke(); }
      continents.forEach((land) => drawContinent(land, w, h, land.id === selectedContinent));
      ctx.fillStyle = 'rgba(224, 242, 255, .7)';
      ctx.font = '700 10px system-ui'; ctx.textAlign = 'left';
      ctx.fillText('EARTH BUILDER · EQUIRECTANGULAR MAP', 14, 20);
      ctx.textAlign = 'right'; ctx.fillStyle = '#d9f5c8'; ctx.font = '700 10px system-ui';
      ctx.fillText('g ' + settings.gravity.toFixed(1) + ' m/s²  ·  ρ ' + settings.density.toFixed(2) + ' kg/m³  ·  rotation ' + settings.rotation.toFixed(1) + ' h', w - 14, 20);
      ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(190, 219, 231, .65)'; ctx.font = '10px system-ui';
      ctx.fillText('Click to place · drag a continent to move · select then remove', 14, h - 14);
    };

    const drawPhysics = (w, h, dt) => {
      ctx.fillStyle = '#071c2b'; ctx.fillRect(0, 0, w, h);
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#092b42'); sky.addColorStop(.68, '#0b2330'); sky.addColorStop(1, '#142e35');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
      drawGrid(w, h);
      const floor = h - 42;
      ctx.fillStyle = '#1e4d43'; ctx.fillRect(0, floor, w, h - floor);
      ctx.strokeStyle = '#4c9279'; ctx.beginPath(); ctx.moveTo(0, floor); ctx.lineTo(w, floor); ctx.stroke();
      const sim = simulationRef.current;
      if (!sim.objects.length) {
        if (scenarioId === 'fall') {
          sim.objects = [
            { id: 'feather', label: 'FEATHER', x: w * .39, y: 56, vx: 0, vy: 0, mass: settings.mass, area: .014, color: '#f0dba7', points: [] },
            { id: 'ball', label: 'BALL', x: w * .61, y: 56, vx: 0, vy: 0, mass: .45, area: .002, color: '#ff9d68', points: [] },
          ];
        } else if (scenarioId === 'projectile' || scenarioId === 'atmosphere' || scenarioId === 'impact') {
          const rad = scenarioId === 'impact' ? 13 + Math.sqrt(settings.mass) * 0.18 : 8;
          const speed = settings.speed * 2.3;
          const angle = settings.angle * Math.PI / 180;
          sim.objects = [{ id: 'projectile', label: scenarioId === 'impact' ? 'IMPACTOR' : 'OBJECT', x: 42, y: floor - 16, vx: speed * Math.cos(angle), vy: -speed * Math.sin(angle), mass: settings.mass, area: Math.PI * Math.pow(settings.radius, 2) * .1, radius: rad, color: '#f4c36e', points: [] }];
        } else if (scenarioId === 'orbit') {
          sim.objects = [{ id: 'satellite', label: 'SATELLITE', x: w * .5 + 100, y: h * .48, vx: 0, vy: -settings.speed * 2.3, mass: 1, area: .001, radius: 5, color: '#9ed4ff', points: [] }];
        }
      }
      if (running) {
        const elapsed = Math.min(.035, dt / 1000);
        sim.t += elapsed;
        sim.objects.forEach((obj) => {
          if (scenarioId === 'orbit') {
            const cx = w * .5, cy = h * .5;
            const dx = cx - obj.x, dy = cy - obj.y;
            const r2 = Math.max(250, dx * dx + dy * dy);
            const accel = clamp(settings.gravity * 0.42 * settings.mass, 0, 20) * 1500 / r2;
            obj.vx += dx / Math.sqrt(r2) * accel * elapsed;
            obj.vy += dy / Math.sqrt(r2) * accel * elapsed;
            obj.x += obj.vx * elapsed * 12;
            obj.y += obj.vy * elapsed * 12;
            if (obj.x < 0 || obj.x > w || obj.y < 0 || obj.y > h) { obj.x = w * .5 + 100; obj.y = h * .5; obj.vx = 0; obj.vy = -settings.speed * 2.3; obj.points = []; }
          } else {
            const dragForce = .5 * settings.density * Math.max(0, settings.drag) * obj.area * (obj.vx - settings.wind) * Math.abs(obj.vx - settings.wind);
            const dragY = .5 * settings.density * Math.max(0, settings.drag) * obj.area * obj.vy * Math.abs(obj.vy);
            const ax = scenarioId === 'fall' ? 0 : -dragForce / Math.max(.001, obj.mass);
            const ay = settings.gravity - dragY / Math.max(.001, obj.mass);
            obj.vx += ax * elapsed * 4;
            obj.vy += ay * elapsed * 4;
            obj.x += obj.vx * elapsed * 9;
            obj.y += obj.vy * elapsed * 9;
            if (scenarioId === 'fall' && obj.y >= floor - 10) { obj.y = floor - 10; obj.vy = 0; obj.vx = 0; }
            if (scenarioId !== 'fall' && obj.y >= floor - 8) {
              obj.y = floor - 8;
              if (scenarioId === 'impact') {
                if (obj.vx !== 0 || obj.vy !== 0) setResult('Impact energy: ' + (0.5 * obj.mass * settings.speed * settings.speed).toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' J');
                obj.vx = 0; obj.vy = 0;
              } else {
                obj.vy = -Math.abs(obj.vy) * .52;
                obj.vx *= .78;
              }
            }
            if (obj.x > w + 40 || obj.x < -40) { obj.x = 42; obj.y = floor - 16; obj.vx = settings.speed * 2.3 * Math.cos(settings.angle * Math.PI / 180); obj.vy = -settings.speed * 2.3 * Math.sin(settings.angle * Math.PI / 180); obj.points = []; }
          }
          if (showTrails) {
            obj.points.push({ x: obj.x, y: obj.y });
            if (obj.points.length > 180) obj.points.shift();
          } else obj.points = [];
        });
      }
      if (scenarioId === 'orbit') {
        const cx = w * .5, cy = h * .5;
        const core = ctx.createRadialGradient(cx, cy, 4, cx, cy, 50);
        core.addColorStop(0, '#fff2b0'); core.addColorStop(.35, '#e8a64c'); core.addColorStop(1, 'rgba(232,166,76,0)');
        ctx.fillStyle = core; ctx.beginPath(); ctx.arc(cx, cy, 50, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#f4cb77'; ctx.beginPath(); ctx.arc(cx, cy, 15, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff0b2'; ctx.font = '10px system-ui'; ctx.textAlign = 'center'; ctx.fillText('CENTRAL BODY', cx, cy + 32);
      }
      sim.objects.forEach((obj) => {
        if (showTrails && obj.points.length > 1) {
          ctx.beginPath(); obj.points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
          ctx.strokeStyle = obj.color + '99'; ctx.lineWidth = 1.5; ctx.stroke();
        }
        ctx.beginPath();
        const radius = obj.radius || (obj.id === 'feather' ? 8 : 12);
        if (obj.id === 'feather') {
          ctx.save(); ctx.translate(obj.x, obj.y); ctx.rotate(Math.sin(sim.t * 3) * .35);
          ctx.fillStyle = obj.color; ctx.beginPath(); ctx.ellipse(0, 0, 5, 13, -.3, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#fff0d2'; ctx.beginPath(); ctx.moveTo(-4, 9); ctx.lineTo(4, -10); ctx.stroke(); ctx.restore();
        } else {
          ctx.fillStyle = obj.color; ctx.arc(obj.x, obj.y, radius, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1; ctx.stroke();
        }
        ctx.fillStyle = '#dcebe6'; ctx.font = '700 9px system-ui'; ctx.textAlign = 'center'; ctx.fillText(obj.label, obj.x, obj.y - 18);
      });
      ctx.fillStyle = 'rgba(219, 238, 233, .78)'; ctx.font = '10px system-ui'; ctx.textAlign = 'left';
      ctx.fillText('g = ' + settings.gravity.toFixed(2) + ' m/s²   ·   drag = ' + settings.drag.toFixed(2) + '   ·   t = ' + sim.t.toFixed(1) + ' s', 14, 20);
      if (!running) {
        ctx.fillStyle = 'rgba(1, 12, 16, .32)'; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#effaf4'; ctx.font = '700 12px system-ui'; ctx.textAlign = 'center';
        ctx.fillText(sim.t > 0 ? 'PAUSED · press RUN to continue' : 'READY · press RUN EXPERIMENT', w / 2, 42);
      }
    };

    const draw = (now) => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width, h = rect.height;
      const dt = lastTime ? now - lastTime : 16;
      lastTime = now;
      if (scenarioId === 'earth') drawEarth(w, h);
      else drawPhysics(w, h, dt);
      raf = window.requestAnimationFrame(draw);
    };
    raf = window.requestAnimationFrame(draw);
    observer.observe(canvas);
    return () => { window.cancelAnimationFrame(raf); observer.disconnect(); };
  }, [scenarioId, settings, running, continents, selectedContinent, showGrid, showTrails, resetTick]);

  const handleCanvasDown = (event) => {
    if (scenarioId !== 'earth' || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const selected = continents.find((land) => land.id === selectedContinent);
    if (mapTool === 'add') {
      const id = 'custom-' + Date.now();
      setContinents((items) => [...items, { id, name: customName.trim() || 'New continent', x, y, sx: .105, sy: .16, points: [[-.4,-.1],[-.2,-.42],[.18,-.4],[.43,-.12],[.32,.22],[.03,.48],[-.28,.29]] }]);
      setSelectedContinent(id);
      setMapTool('select');
      setResult('Continent added at ' + Math.round(x * 360 - 180) + '° longitude, ' + Math.round(90 - y * 180) + '° latitude.');
      return;
    }
    const hit = [...continents].reverse().find((land) => Math.abs(x - land.x) < land.sx * .55 && Math.abs(y - land.y) < land.sy * .58);
    if (hit) {
      setSelectedContinent(hit.id);
      pointerRef.current = { id: hit.id, startX: x, startY: y, originX: hit.x, originY: hit.y };
      canvasRef.current.setPointerCapture?.(event.pointerId);
    } else if (selected) setSelectedContinent(null);
  };

  const handleCanvasMove = (event) => {
    if (!pointerRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    const drag = pointerRef.current;
    setContinents((items) => items.map((land) => land.id === drag.id ? { ...land, x: clamp(drag.originX + x - drag.startX, 0, 1), y: clamp(drag.originY + y - drag.startY, 0, 1) } : land));
  };
  const handleCanvasUp = () => { pointerRef.current = null; };

  const removeContinent = () => {
    if (!selectedContinent) return;
    setContinents((items) => items.filter((land) => land.id !== selectedContinent));
    setResult('Continent removed.');
    setSelectedContinent(null);
  };
  const resetContinents = () => {
    setContinents(INITIAL_CONTINENTS.map((land) => ({ ...land })));
    setSelectedContinent('af');
    setMapTool('select');
    setResult('Earth map restored.');
  };

  const runLabel = running ? 'Pause experiment' : 'Run experiment';
  const gravityControl = <Slider label="Gravity" value={settings.gravity} min={0} max={30} step={0.1} unit=" m/s²" onChange={(v) => updateSetting('gravity', v)} />;
  const dragControl = <Slider label="Air resistance (drag)" value={settings.drag} min={0} max={2} step={0.01} onChange={(v) => updateSetting('drag', v)} />;
  const densityControl = <Slider label="Air density" value={settings.density} min={0} max={2.5} step={0.025} unit=" kg/m³" onChange={(v) => updateSetting('density', v)} />;
  const windControl = <Slider label="Wind speed" value={settings.wind} min={-30} max={30} step={0.5} unit=" m/s" onChange={(v) => updateSetting('wind', v)} />;
  const speedControl = <Slider label="Initial speed" value={settings.speed} min={0} max={80} step={0.5} unit=" m/s" onChange={(v) => updateSetting('speed', v)} />;
  const massControl = <Slider label="Object mass" value={settings.mass} min={0.1} max={1000} step={0.1} unit=" kg" onChange={(v) => updateSetting('mass', v)} />;
  const angleControl = <Slider label="Launch angle" value={settings.angle} min={0} max={90} step={1} unit="°" onChange={(v) => updateSetting('angle', v)} />;
  const rotationControl = <Slider label="Planet rotation" value={settings.rotation} min={0} max={48} step={0.5} unit=" h" onChange={(v) => updateSetting('rotation', v)} />;

  return <main className="earth-sandbox">
    <header className="sandbox-topbar">
      <button className="sandbox-home" onClick={onHome} type="button">← Earth Systems</button>
      <div className="sandbox-brand"><span className="sandbox-brand-icon">◇</span><span><strong>EARTH SANDBOX</strong><small>Interactive experiment suite</small></span></div>
      <button className="sandbox-terminal" onClick={onOpenTerminal} type="button">Diagnostics</button>
    </header>
    <div className="sandbox-layout">
      <aside className="sandbox-sidebar">
        <div className="sandbox-section-label">EXPERIMENTS</div>
        {SCENARIOS.map((item) => <button key={item.id} className={'sandbox-scenario' + (scenarioId === item.id ? ' active' : '')} onClick={() => changeScenario(item.id)} type="button">
          <span className="sandbox-scenario-glyph">{item.id === 'fall' ? '↓' : item.id === 'projectile' ? '↗' : item.id === 'orbit' ? '◉' : item.id === 'earth' ? '◎' : item.id === 'impact' ? '✳' : '≈'}</span>
          <span><strong>{item.name}</strong><small>{item.tag}</small></span>
        </button>)}
        <div className="sandbox-sidebar-note"><strong>Sandbox rule</strong><p>Every experiment is editable. Change a value, reset, then run again to compare results.</p></div>
      </aside>
      <section className="sandbox-workspace">
        <div className="sandbox-heading">
          <div><p className="sandbox-eyebrow">EARTH SYSTEMS / LAB MODE</p><h1>{scenario.name}</h1><p>{scenario.intro}</p></div>
          <div className="sandbox-heading-actions"><button type="button" className="sandbox-secondary" onClick={() => setShowGrid((v) => !v)}>{showGrid ? 'Hide grid' : 'Show grid'}</button><button type="button" className="sandbox-secondary" onClick={() => setShowTrails((v) => !v)}>{showTrails ? 'Hide trails' : 'Show trails'}</button></div>
        </div>
        <div className="sandbox-stage-wrap">
          <canvas ref={canvasRef} className={'sandbox-canvas' + (scenarioId === 'earth' ? ' map-canvas' : '')} aria-label={scenarioId === 'earth' ? 'Editable world map. Add continents by selecting Add continent and clicking anywhere. Drag existing continents to move them.' : 'Animated physics experiment'} onPointerDown={handleCanvasDown} onPointerMove={handleCanvasMove} onPointerUp={handleCanvasUp} onPointerCancel={handleCanvasUp} />
          <div className="sandbox-stage-footer"><span><i className={running ? 'sandbox-live-dot live' : 'sandbox-live-dot'} />{running ? 'SIMULATION RUNNING' : 'SIMULATION PAUSED'}</span><span>{scenarioId === 'earth' ? continents.length + ' continents' : 'Model: simplified, adjustable physics'}</span></div>
        </div>
        <div className="sandbox-action-row">
          <button type="button" className="sandbox-run" onClick={() => { setRunning((v) => !v); setResult(running ? 'Paused' : 'Experiment running'); }}>{runLabel}</button>
          <button type="button" className="sandbox-secondary" onClick={reset}>Reset experiment</button>
          {scenarioId === 'earth' && <button type="button" className="sandbox-secondary" onClick={resetContinents}>Restore continents</button>}
          <span className="sandbox-result" aria-live="polite">{result}</span>
        </div>
      </section>
      <aside className="sandbox-controls">
        <div className="sandbox-controls-heading"><div><p className="sandbox-eyebrow">LIVE PARAMETERS</p><h2>World settings</h2></div><span className="sandbox-edit-tag">EDITABLE</span></div>
        {scenarioId === 'fall' && <div className="sandbox-control-group"><p className="sandbox-group-title">Environment</p>{gravityControl}{dragControl}{densityControl}<Slider label="Feather mass" value={selectedObject === 'feather' ? 0.003 : 0.45} min={0.001} max={1} step={0.001} unit=" kg" onChange={(v) => { setSelectedObject('feather'); updateSetting('mass', v); }} /><p className="sandbox-control-hint">In a vacuum, both objects accelerate equally. Drag depends on shape, area and speed, not just mass.</p></div>}
        {scenarioId === 'projectile' && <div className="sandbox-control-group"><p className="sandbox-group-title">Launch conditions</p>{gravityControl}{speedControl}{angleControl}{dragControl}{densityControl}{windControl}</div>}
        {scenarioId === 'orbit' && <div className="sandbox-control-group"><p className="sandbox-group-title">Orbital conditions</p>{gravityControl}{speedControl}<Slider label="Central body strength" value={settings.mass} min={0.1} max={10} step={0.1} unit="×" onChange={(v) => updateSetting('mass', v)} /><p className="sandbox-control-hint">This 2D model is illustrative, not a precision orbital propagator. Drag is ignored in this scenario.</p></div>}
        {scenarioId === 'earth' && <div className="sandbox-control-group"><p className="sandbox-group-title">Planet properties</p>{gravityControl}{densityControl}{rotationControl}<label className="sandbox-text-field"><span>New continent name</span><input value={customName} onChange={(event) => setCustomName(event.target.value)} maxLength={28} /></label><div className="sandbox-map-tools"><button type="button" className={mapTool === 'select' ? 'active' : ''} onClick={() => setMapTool('select')}>Select / move</button><button type="button" className={mapTool === 'add' ? 'active' : ''} onClick={() => { setMapTool('add'); setResult('Click anywhere on the map to place a continent.'); }}>+ Add continent</button></div><div className="sandbox-continent-list">{continents.map((land) => <button key={land.id} type="button" className={selectedContinent === land.id ? 'active' : ''} onClick={() => setSelectedContinent(land.id)}><span>{land.name}</span><small>{Math.round(land.x * 360 - 180)}°, {Math.round(90 - land.y * 180)}°</small></button>)}</div><button type="button" className="sandbox-danger" disabled={!selectedContinent} onClick={removeContinent}>Remove selected continent</button><p className="sandbox-control-hint">Map edits are local to this session. Continent outlines are simplified shapes, not real topography.</p></div>}
        {scenarioId === 'impact' && <div className="sandbox-control-group"><p className="sandbox-group-title">Impact conditions</p>{gravityControl}{speedControl}{massControl}<Slider label="Impactor radius" value={settings.radius} min={0.1} max={5} step={0.1} unit=" m" onChange={(v) => updateSetting('radius', v)} />{dragControl}<div className="sandbox-metric"><span>Kinetic energy</span><strong>{(0.5 * settings.mass * settings.speed * settings.speed).toLocaleString(undefined, { maximumFractionDigits: 0 })} J</strong></div><p className="sandbox-control-hint">Kinetic energy = ½ × mass × speed². Crater size depends on many additional factors not modelled here.</p></div>}
        {scenarioId === 'atmosphere' && <div className="sandbox-control-group"><p className="sandbox-group-title">Atmospheric conditions</p>{gravityControl}{speedControl}{dragControl}{densityControl}{windControl}<p className="sandbox-control-hint">Air resistance grows with air density and approximately with the square of relative speed in this simplified model.</p></div>}
        <div className="sandbox-reset-row"><button type="button" onClick={() => { setSettings({ ...PRESETS[scenarioId] }); reset(); }}>Restore scenario defaults</button></div>
      </aside>
    </div>
    <footer className="sandbox-footer"><span>EARTH SANDBOX SIMULATOR</span><span>Educational models · Values are adjustable · Results are approximate</span></footer>
    {terminal}
  </main>;
}
