import React, { useEffect, useMemo, useState } from 'react';
import { PLATE_BOUNDARIES } from './data';

const MAP_WIDTH = 1000;
const MAP_HEIGHT = 500;

const TYPE_META = {
  Convergent: {
    key: 'convergent',
    colour: '#ffad78',
    short: 'Move together',
    description: 'Two plates move towards one another. One plate may sink beneath the other (subduction), or two continents may collide and crumple into a mountain belt.',
    results: [
      ['Mountains', 'Continental collision can thicken and uplift crust, as in the Himalaya.'],
      ['Earthquakes', 'Stress builds as plates push together; subduction zones can produce powerful earthquakes.'],
      ['Volcanoes', 'Water released from a sinking slab can help generate magma above a subduction zone. Continental collision alone does not normally create a volcanic arc.'],
    ],
  },
  Divergent: {
    key: 'divergent',
    colour: '#79e0b7',
    short: 'Move apart',
    description: 'Two plates separate. Hot mantle rises to fill the gap; as it cools, it can create new oceanic crust. On continents, this stretching can form a rift valley.',
    results: [
      ['Mountains and ridges', 'Upwelling and newly formed crust build elevated mid-ocean ridges; continental rifting can create steep fault-bounded escarpments.'],
      ['Earthquakes', 'The crust cracks and slips as it stretches, usually producing shallow earthquakes.'],
      ['Volcanoes', 'Rising mantle can melt as pressure falls, allowing basaltic magma to erupt at ridges and rifts.'],
    ],
  },
  Transform: {
    key: 'transform',
    colour: '#a7c8ff',
    short: 'Slide past',
    description: 'Two plates slide sideways past each other. Friction may lock a fault until stress is released in an earthquake. Crust is not normally made or destroyed along the fault.',
    results: [
      ['Mountains', 'Some transform systems create local uplift or pull-apart basins, but mountain building is not their defining effect.'],
      ['Earthquakes', 'Fault sections can lock, accumulate strain and slip suddenly, generating shallow earthquakes.'],
      ['Volcanoes', 'Volcanoes are uncommon along transform boundaries themselves because they do not usually create the conditions that generate magma.'],
    ],
  },
};

const MOTION_OPTIONS = [
  { id: 'continental-drift', label: 'Continental drift', type: 'Divergent', detail: 'Continental crust stretches and separates in this simplified rifting experiment.' },
  { id: 'seafloor-spreading', label: 'Seafloor spreading', type: 'Divergent', detail: 'New oceanic crust forms at a mid-ocean ridge as plates move apart.' },
  { id: 'subduction', label: 'Subduction', type: 'Convergent', detail: 'A denser oceanic plate bends and sinks beneath another plate.' },
  { id: 'transform-slip', label: 'Transform fault', type: 'Transform', detail: 'Plates shear sideways; stress can build along a locked fault and release as an earthquake.' },
];

function boundaryColour(type) {
  return TYPE_META[type]?.colour || '#a7c8ff';
}

function mapPoint(longitude, latitude) {
  return {
    x: ((Number(longitude) + 180) / 360) * MAP_WIDTH,
    y: ((90 - Number(latitude)) / 180) * MAP_HEIGHT,
  };
}

function boundaryPath(points) {
  return (points || []).map((point, index) => {
    const mapped = mapPoint(point[0], point[1]);
    return (index ? 'L' : 'M') + mapped.x.toFixed(2) + ',' + mapped.y.toFixed(2);
  }).join(' ');
}

function geometryPath(geometry) {
  if (!geometry) return '';
  const parts = [];
  const addRing = (ring, close = true) => {
    if (!Array.isArray(ring) || ring.length < 2) return;
    let segment = [];
    const pushSegment = () => {
      if (segment.length < 2) return;
      parts.push(segment.map((point, index) => {
        const mapped = mapPoint(point[0], point[1]);
        return (index ? 'L' : 'M') + mapped.x.toFixed(2) + ',' + mapped.y.toFixed(2);
      }).join(' ') + (close ? ' Z' : ''));
      segment = [];
    };
    ring.forEach((point, index) => {
      if (index && Math.abs(Number(point[0]) - Number(ring[index - 1][0])) > 180) pushSegment();
      segment.push(point);
    });
    pushSegment();
  };
  const visit = (shape) => {
    if (!shape) return;
    if (shape.type === 'Polygon') (shape.coordinates || []).forEach((ring) => addRing(ring));
    else if (shape.type === 'MultiPolygon') (shape.coordinates || []).forEach((poly) => poly.forEach((ring) => addRing(ring)));
    else if (shape.type === 'GeometryCollection') (shape.geometries || []).forEach(visit);
  };
  visit(geometry);
  return parts.join(' ');
}

function iconArrow(x1, y1, x2, y2, className) {
  return <line className={className} x1={x1} y1={y1} x2={x2} y2={y2} markerEnd="url(#lab-arrowhead)" />;
}

function CrossSection({ motionMode, playing }) {
  const mode = motionMode;
  const isSubduction = mode === 'subduction';
  const isSpreading = mode === 'seafloor-spreading';
  const isDrift = mode === 'continental-drift';
  const isTransform = mode === 'transform-slip';
  const ariaTitle = isSubduction ? 'Subduction cross-section' : isSpreading ? 'Seafloor spreading cross-section' : isDrift ? 'Continental drift cross-section' : 'Transform fault cross-section';

  return (
    <svg className={'lab-cross-section ' + (playing ? 'is-playing' : 'is-paused') + ' mode-' + mode} viewBox="0 0 900 360" role="img" aria-label={ariaTitle}>
      <defs>
        <linearGradient id="lab-sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#102b35" />
          <stop offset="100%" stopColor="#0c202b" />
        </linearGradient>
        <linearGradient id="lab-mantle" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#8b493e" />
          <stop offset="100%" stopColor="#482a37" />
        </linearGradient>
        <linearGradient id="lab-crust" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#6f8f91" />
          <stop offset="100%" stopColor="#304e60" />
        </linearGradient>
        <marker id="lab-arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill="#d6f3e4" />
        </marker>
        <marker id="lab-hot-arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill="#ff9d68" />
        </marker>
      </defs>
      <rect width="900" height="360" fill="url(#lab-sky)" />
      <path d="M0 145 C140 138 240 147 360 143 S650 147 900 140 L900 360 L0 360 Z" fill="url(#lab-mantle)" opacity=".94" />
      <path d="M0 146 H900" stroke="#ffbd84" strokeOpacity=".28" strokeWidth="2" strokeDasharray="4 7" />
      <g opacity=".13" stroke="#f5ce9d" strokeWidth="1">
        {Array.from({ length: 9 }, (_, index) => <path key={index} d={'M0 ' + (185 + index * 20) + ' H900'} />)}
        {Array.from({ length: 18 }, (_, index) => <path key={index} d={'M' + (30 + index * 50) + ' 155 V360'} />)}
      </g>

      {isSubduction && (
        <g className="lab-section-convergent">
          <path d="M0 95 H365 L405 116 L435 147 L455 156 L520 189 L585 244 L630 270 L647 292 L657 360 L0 360 Z" fill="url(#lab-crust)" stroke="#a4c1c6" strokeOpacity=".66" strokeWidth="2" className="lab-subducting-slab" />
          <path d="M398 105 L900 105 L900 170 L478 170 L444 149 L423 127 Z" fill="#73978b" stroke="#c0d8ba" strokeOpacity=".66" strokeWidth="2" />
          <path d="M435 145 L465 158 L447 164 L425 154 Z" fill="#172c37" />
          <path d="M451 156 C470 148 484 155 493 172 C503 191 501 215 520 230 C541 249 556 253 557 279 C534 266 514 256 496 236 C475 214 469 185 451 156 Z" fill="#fc8862" opacity=".2" className="lab-magma-glow" />
          <path d="M486 168 C500 192 500 217 522 240" fill="none" stroke="#ff9d68" strokeWidth="5" strokeLinecap="round" className="lab-magma-rise" />
          <path d="M560 106 L580 86 L598 106 L615 78 L636 106 L654 91 L675 106 Z" fill="#9a9588" stroke="#d3c9b1" strokeWidth="1.5" />
          <path d="M615 103 C610 83 620 72 628 56 C636 74 645 88 639 103 Z" fill="#c7e3cc" opacity=".7" />
          {iconArrow(115, 58, 320, 58, 'lab-motion-arrow lab-arrow-forward')}
          {iconArrow(790, 58, 615, 58, 'lab-motion-arrow lab-arrow-back')}
          <path d="M372 96 L404 113 L425 137" fill="none" stroke="#ffbd84" strokeWidth="2" strokeDasharray="4 4" />
          <text x="72" y="38" className="lab-svg-label">OCEANIC PLATE</text>
          <text x="657" y="38" className="lab-svg-label">OVERRIDING PLATE</text>
          <text x="366" y="88" className="lab-svg-label lab-svg-label-hot">TRENCH</text>
          <text x="657" y="73" className="lab-svg-label">VOLCANIC ARC</text>
          <text x="492" y="301" className="lab-svg-label lab-svg-label-hot">SINKING SLAB</text>
          <text x="662" y="207" className="lab-svg-label">CRUST</text>
          <text x="38" y="328" className="lab-svg-label lab-svg-label-muted">MANTLE</text>
        </g>
      )}

      {isDrift && (
        <g className="lab-section-drift">
          <path d="M0 105 L310 105 L350 123 L375 151 L0 151 Z" fill="#a18d67" stroke="#d9c9a2" strokeWidth="2" />
          <path d="M900 105 L590 105 L550 123 L525 151 L900 151 Z" fill="#a18d67" stroke="#d9c9a2" strokeWidth="2" />
          <path d="M310 105 L350 123 L375 151 M590 105 L550 123 L525 151" fill="none" stroke="#ffb47b" strokeWidth="3" />
          <path d="M370 151 C390 195 390 230 420 260 C438 278 445 302 450 333 C455 302 462 278 480 260 C510 230 510 195 530 151 Z" fill="#f67f59" opacity=".72" className="lab-rift-magma" />
          <path d="M0 151 H370 L420 260 L450 286 L480 260 L530 151 H900 V360 H0 Z" fill="url(#lab-crust)" opacity=".94" />
          <path d="M0 151 H370 L420 260 L450 286 L480 260 L530 151 H900" fill="none" stroke="#d4c5a2" strokeWidth="2.5" />
          {iconArrow(120, 65, 310, 65, 'lab-motion-arrow lab-arrow-forward')}
          {iconArrow(780, 65, 590, 65, 'lab-motion-arrow lab-arrow-back')}
          <text x="70" y="36" className="lab-svg-label">CONTINENTAL CRUST</text>
          <text x="610" y="36" className="lab-svg-label">CONTINENTAL CRUST</text>
          <text x="390" y="112" className="lab-svg-label lab-svg-label-hot">RIFT VALLEY</text>
          <text x="44" y="328" className="lab-svg-label lab-svg-label-muted">MANTLE</text>
          <text x="484" y="224" className="lab-svg-label lab-svg-label-hot">RISING MAGMA</text>
        </g>
      )}

      {isSpreading && (
        <g className="lab-section-spreading">
          <path d="M0 108 H382 L410 136 L432 158 L449 161 L466 158 L488 136 L516 108 H900 V175 H0 Z" fill="url(#lab-crust)" stroke="#adc7cd" strokeOpacity=".65" strokeWidth="2" />
          <path d="M381 108 L410 136 L432 158 L449 161 L466 158 L488 136 L516 108" fill="none" stroke="#d6e9d5" strokeWidth="3" />
          <path d="M412 360 C423 312 432 252 440 194 L450 160 L460 194 C468 252 477 312 488 360 Z" fill="#fb835d" opacity=".86" className="lab-spreading-magma" />
          <path d="M439 161 L450 143 L461 161" fill="none" stroke="#ffc18a" strokeWidth="4" strokeLinecap="round" />
          {iconArrow(365, 65, 225, 65, 'lab-motion-arrow lab-arrow-forward')}
          {iconArrow(535, 65, 675, 65, 'lab-motion-arrow lab-arrow-back')}
          <text x="50" y="35" className="lab-svg-label">OCEANIC PLATE</text>
          <text x="685" y="35" className="lab-svg-label">OCEANIC PLATE</text>
          <text x="400" y="101" className="lab-svg-label lab-svg-label-hot">MID-OCEAN RIDGE</text>
          <text x="510" y="230" className="lab-svg-label lab-svg-label-hot">NEW CRUST</text>
          <text x="42" y="328" className="lab-svg-label lab-svg-label-muted">MANTLE</text>
        </g>
      )}

      {isTransform && (
        <g className="lab-section-transform">
          <path d="M0 105 H440 L465 130 L465 180 H0 Z" fill="#617f8a" stroke="#a6c6cb" strokeWidth="2" />
          <path d="M465 130 L490 105 H900 V180 H465 Z" fill="#496e79" stroke="#a6c6cb" strokeWidth="2" />
          <path d="M465 130 L465 310" stroke="#ffbd84" strokeWidth="4" strokeDasharray="7 6" className="lab-transform-fault" />
          <path d="M0 180 H900 V360 H0 Z" fill="url(#lab-mantle)" opacity=".6" />
          <path d="M0 180 H440 L465 205 L490 180 H900 V360 H0 Z" fill="url(#lab-crust)" opacity=".85" />
          <path d="M465 130 L465 310" stroke="#ffbd84" strokeWidth="4" strokeDasharray="7 6" className="lab-transform-fault" />
          {iconArrow(350, 64, 190, 64, 'lab-motion-arrow lab-arrow-forward')}
          {iconArrow(550, 64, 710, 64, 'lab-motion-arrow lab-arrow-back')}
          <g className="lab-earthquake-spark" stroke="#ffe6a7" strokeWidth="3" fill="none" strokeLinecap="round">
            <path d="M440 205 l-12 20 18 -3 -9 20 24 -28 -17 2 9 -11" />
          </g>
          <text x="68" y="35" className="lab-svg-label">PLATE A</text>
          <text x="675" y="35" className="lab-svg-label">PLATE B</text>
          <text x="490" y="246" className="lab-svg-label lab-svg-label-hot">FAULT PLANE</text>
          <text x="39" y="328" className="lab-svg-label lab-svg-label-muted">MANTLE BELOW CRUST</text>
          <text x="540" y="205" className="lab-svg-label">SHALLOW EARTHQUAKES</text>
        </g>
      )}
      <text x="875" y="340" textAnchor="end" className="lab-svg-footer">SCHEMATIC · NOT TO SCALE</text>
    </svg>
  );
}

export default function PlateTectonicsLab({ countries = [], initialBoundaryName = null, onHome }) {
  const initialBoundary = PLATE_BOUNDARIES.find((boundary) => boundary.name === initialBoundaryName) || PLATE_BOUNDARIES[0];
  const [selectedBoundaryName, setSelectedBoundaryName] = useState(initialBoundary.name);
  const [typeFilter, setTypeFilter] = useState('all');
  const [simulatedType, setSimulatedType] = useState(initialBoundary.type);
  const [motionMode, setMotionMode] = useState(initialBoundary.type === 'Convergent' ? 'subduction' : initialBoundary.type === 'Divergent' ? 'seafloor-spreading' : 'transform-slip');
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!initialBoundaryName) return;
    const found = PLATE_BOUNDARIES.find((boundary) => boundary.name === initialBoundaryName);
    if (!found) return;
    setSelectedBoundaryName(found.name);
    setSimulatedType(found.type);
    setMotionMode(found.type === 'Convergent' ? 'subduction' : found.type === 'Divergent' ? 'seafloor-spreading' : 'transform-slip');
  }, [initialBoundaryName]);

  const selectedBoundary = PLATE_BOUNDARIES.find((boundary) => boundary.name === selectedBoundaryName) || PLATE_BOUNDARIES[0];
  const typeMeta = TYPE_META[simulatedType] || TYPE_META.Convergent;
  const selectedMotion = MOTION_OPTIONS.find((motion) => motion.id === motionMode) || MOTION_OPTIONS[0];

  const mapCountries = useMemo(() => countries.map((country, index) => ({
    id: String(country.id || country.properties?.name || index),
    name: country.properties?.name || 'Land',
    path: geometryPath(country.geometry),
  })).filter((country) => country.path), [countries]);

  const visibleBoundaries = useMemo(() => PLATE_BOUNDARIES.filter((boundary) =>
    typeFilter === 'all' || boundary.type.toLowerCase() === typeFilter
  ), [typeFilter]);

  const selectBoundary = (boundary) => {
    setSelectedBoundaryName(boundary.name);
    setSimulatedType(boundary.type);
    setMotionMode(boundary.type === 'Convergent' ? 'subduction' : boundary.type === 'Divergent' ? 'seafloor-spreading' : 'transform-slip');
  };

  const selectType = (type) => {
    setSimulatedType(type);
    if (type === 'Convergent') setMotionMode('subduction');
    else if (type === 'Divergent') setMotionMode('seafloor-spreading');
    else setMotionMode('transform-slip');
  };

  const selectMotion = (motion) => {
    setMotionMode(motion.id);
    setSimulatedType(motion.type);
  };

  return (
    <main className="plate-lab">
      <header className="plate-lab-topbar">
        <button type="button" className="plate-lab-home" onClick={onHome} aria-label="Return to Earth Systems home">
          <span className="lab-home-orb" aria-hidden="true">◉</span><span>EARTH SYSTEMS</span>
        </button>
        <div className="plate-lab-topmeta"><span className="lab-beta-badge">BETA</span><span>INTERACTIVE GEOLOGY</span></div>
      </header>

      <section className="plate-lab-hero">
        <div>
          <p className="lab-kicker">FIELD LAB 03 / LITHOSPHERE</p>
          <h1>Plate Tectonics <span>Laboratory</span></h1>
          <p className="lab-hero-summary">Explore real-world examples, then change the boundary type in a controlled model to see how the surface and the crust respond.</p>
        </div>
        <div className="lab-beta-card"><span>EXPERIMENTAL</span><strong>Interactive model</strong><small>Diagrams are simplified, not to scale.</small></div>
      </section>

      <div className="plate-lab-workspace">
        <section className="plate-lab-map-panel">
          <div className="lab-panel-header">
            <div><p className="lab-kicker">01 / GLOBAL MAP</p><h2>Explore boundaries</h2></div>
            <span>{visibleBoundaries.length} segments</span>
          </div>
          <div className="lab-type-filters" aria-label="Filter mapped boundaries by type">
            <button type="button" className={typeFilter === 'all' ? 'is-active' : ''} onClick={() => setTypeFilter('all')}>All types</button>
            {Object.keys(TYPE_META).map((type) => <button type="button" key={type} className={typeFilter === type.toLowerCase() ? 'is-active' : ''} onClick={() => setTypeFilter(type.toLowerCase())}><i style={{ background: TYPE_META[type].colour }} />{type}</button>)}
          </div>
          <div className="lab-world-map-wrap">
            <svg className="lab-world-map" viewBox={'0 0 ' + MAP_WIDTH + ' ' + MAP_HEIGHT} role="img" aria-label="World map showing clickable tectonic boundary examples">
              <defs>
                <pattern id="lab-map-grid" width="83.333" height="41.666" patternUnits="userSpaceOnUse">
                  <path d="M83.333 0 H0 V41.666" fill="none" stroke="#8db6c8" strokeOpacity=".13" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="#0b202d" />
              <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="url(#lab-map-grid)" />
              {[-60, -30, 0, 30, 60].map((latitude) => <path key={latitude} d={'M0 ' + mapPoint(-180, latitude).y + ' H' + MAP_WIDTH} stroke="#8db6c8" strokeOpacity=".12" strokeWidth="1" fill="none" />)}
              {mapCountries.map((country) => <path key={country.id} d={country.path} className="lab-country-shape" aria-label={country.name} />)}
              {visibleBoundaries.map((boundary) => (
                <g key={boundary.name} className="lab-boundary-hit-group" onClick={() => selectBoundary(boundary)} role="button" tabIndex="0" aria-label={'Select ' + boundary.name + ', ' + boundary.type + ' boundary'} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectBoundary(boundary); } }}>
                  <path d={boundaryPath(boundary.points)} className="lab-boundary-hit-target" />
                  <path d={boundaryPath(boundary.points)} className={'lab-boundary-line ' + (selectedBoundary.name === boundary.name ? 'is-selected' : '')} style={{ stroke: boundaryColour(boundary.type) }} />
                  {boundary.points.length > 2 && <circle className="lab-boundary-node" cx={mapPoint(boundary.points[Math.floor(boundary.points.length / 2)][0], boundary.points[Math.floor(boundary.points.length / 2)][1]).x} cy={mapPoint(boundary.points[Math.floor(boundary.points.length / 2)][0], boundary.points[Math.floor(boundary.points.length / 2)][1]).y} r={selectedBoundary.name === boundary.name ? 5 : 2.7} style={{ fill: boundaryColour(boundary.type) }} />}
                </g>
              ))}
              <text x="18" y="25" className="lab-map-caption">PLATE-BOUNDARY EXAMPLES</text>
              <text x="982" y="482" textAnchor="end" className="lab-map-caption">SCHEMATIC WORLD MAP</text>
            </svg>
          </div>
          <p className="lab-map-hint">Select a coloured line or choose a boundary below. These are named examples, not a complete scientific plate-boundary dataset.</p>
          <div className="lab-boundary-list">
            {visibleBoundaries.map((boundary) => <button type="button" key={boundary.name} className={'lab-boundary-row ' + (selectedBoundary.name === boundary.name ? 'is-selected' : '')} onClick={() => selectBoundary(boundary)}>
              <span className="lab-boundary-swatch" style={{ background: boundaryColour(boundary.type) }} />
              <span className="lab-boundary-row-copy"><strong>{boundary.name}</strong><small>{boundary.type} · {TYPE_META[boundary.type].short}</small></span>
              <span aria-hidden="true">↗</span>
            </button>)}
          </div>
        </section>

        <section className="plate-lab-simulator-panel">
          <div className="lab-panel-header">
            <div><p className="lab-kicker">02 / BUILD A SCENARIO</p><h2>Change the boundary</h2></div>
            <span className="lab-simulator-badge">LIVE MODEL</span>
          </div>
          <div className="lab-selected-boundary">
            <span className="lab-selected-marker" style={{ background: boundaryColour(selectedBoundary.type) }} />
            <div><small>SELECTED REAL-WORLD EXAMPLE</small><strong>{selectedBoundary.name}</strong><span>Mapped type: {selectedBoundary.type}</span></div>
          </div>
          <p className="lab-model-note">You can change the model type below. This is a hypothetical experiment; it does not change the mapped boundary's real classification.</p>
          <div className="lab-sim-type-buttons" aria-label="Simulated boundary type">
            {Object.keys(TYPE_META).map((type) => <button type="button" key={type} className={simulatedType === type ? 'is-active' : ''} onClick={() => selectType(type)} style={{ '--lab-type-colour': TYPE_META[type].colour }} aria-pressed={simulatedType === type}>{type}<small>{TYPE_META[type].short}</small></button>)}
          </div>
          <div className="lab-scenario-heading"><span className="lab-kicker">MOTION EXPERIMENT</span><button type="button" className="lab-play-toggle" onClick={() => setPlaying((value) => !value)} aria-pressed={playing}>{playing ? 'Ⅱ Pause motion' : '▶ Play motion'}</button></div>
          <div className="lab-motion-options">
            {MOTION_OPTIONS.map((motion) => <button type="button" key={motion.id} className={motionMode === motion.id ? 'is-active' : ''} onClick={() => selectMotion(motion)} aria-pressed={motionMode === motion.id}>{motion.label}<span>{motion.type}</span></button>)}
          </div>
          <p className="lab-motion-description">{selectedMotion.detail}</p>
          <div className="lab-cross-section-head"><div><p className="lab-kicker">03 / BELOW THE SURFACE</p><h2>{selectedMotion.label}</h2></div><span style={{ color: typeMeta.colour }}>{typeMeta.short.toUpperCase()}</span></div>
          <CrossSection motionMode={motionMode} playing={playing} />
          <p className="lab-diagram-footnote">Conceptual cross-section · motion is greatly accelerated and distances are not to scale.</p>
        </section>
      </div>

      <section className="lab-outcomes-panel">
        <div className="lab-outcomes-intro"><p className="lab-kicker">04 / GEOLOGICAL CONSEQUENCES</p><h2>What happens at this boundary?</h2><p>{typeMeta.description}</p></div>
        <div className="lab-outcomes-grid">
          {typeMeta.results.map(([title, detail], index) => <article className="lab-outcome-card" key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{detail}</p></article>)}
        </div>
      </section>

      <footer className="plate-lab-footer"><span>EARTH SYSTEMS · PLATE TECTONICS LABORATORY</span><button type="button" onClick={onHome}>Back to systems ↗</button><span>Beta model · Educational schematic, not a forecast</span></footer>
    </main>
  );
}
