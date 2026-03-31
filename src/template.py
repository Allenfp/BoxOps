"""HTML template generation for BoxOps."""

import json
from typing import Any, Optional


def generate_html(all_processes: list[dict[str, Any]], people: list[dict[str, Any]], raw_processes: Optional[list[dict[str, Any]]] = None) -> str:
    """Generate self-contained HTML with D3.js 2D visualization."""
    data_json = json.dumps(all_processes)
    people_summary_json = json.dumps([{"name": p["name"], "flight_risk": p.get("flight_risk", "low")} for p in people])
    people_full_json = json.dumps(people)
    raw_processes_json = json.dumps(raw_processes or [])

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BoxOps — Knowledge Coverage</title>
    <script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            background: #1a1a2e;
            display: flex;
            flex-direction: column;
            align-items: center;
            min-height: 100vh;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding-bottom: 40px;
        }}
        .navbar {{
            width: 100%;
            background: #0f0f23;
            border-bottom: 1px solid #2a2a4a;
            display: flex;
            align-items: center;
            padding: 0 24px;
            gap: 0;
            position: sticky;
            top: 0;
            z-index: 20;
        }}
        .navbar .brand {{
            color: #ffffff;
            font-size: 15px;
            font-weight: 700;
            letter-spacing: 0.5px;
            padding: 12px 16px 12px 0;
            border-right: 1px solid #2a2a4a;
            margin-right: 4px;
            white-space: nowrap;
        }}
        .navbar .nav-tab {{
            padding: 12px 20px;
            color: #8888aa;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            border: none;
            background: none;
            border-bottom: 3px solid transparent;
            transition: all 0.15s;
        }}
        .navbar .nav-tab:hover {{
            color: #ccccdd;
        }}
        .navbar .nav-tab.active {{
            color: #ffffff;
            border-bottom-color: #20c40a;
        }}
        .sticky-header {{
            position: sticky;
            top: 45px;
            z-index: 10;
            background: #1a1a2e;
            display: flex;
            flex-direction: column;
            align-items: center;
            width: 100%;
        }}
        .controls {{
            margin-top: 10px;
            margin-bottom: 0;
            display: flex;
            gap: 20px;
            padding: 12px 20px;
            align-items: center;
        }}
        .control-group {{
            display: flex;
            align-items: center;
            gap: 4px;
        }}
        .control-group .group-label {{
            font-size: 12px;
            font-weight: 600;
            margin-right: 4px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }}
        .control-group.people-group .group-label {{ color: #20c40a; }}
        .control-group.colorby-group .group-label {{ color: #c0c0c0; }}
        .control-group.doc-group .group-label {{ color: #00d2ff; }}
        .control-group.complexity-group .group-label {{ color: #ff6b6b; }}
        .control-group button {{
            padding: 6px 14px;
            border-radius: 5px;
            background: transparent;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s;
        }}
        .control-group button:hover {{
            opacity: 0.85;
        }}
        .people-group button {{
            border: 2px solid #20c40a;
            color: #20c40a;
        }}
        .people-group button.active {{
            background: #20c40a;
            color: #1a1a2e;
        }}
        .doc-group button {{
            border: 2px solid #00d2ff;
            color: #00d2ff;
        }}
        .doc-group button.active {{
            background: #00d2ff;
            color: #1a1a2e;
        }}
        .complexity-group button {{
            border: 2px solid #ff6b6b;
            color: #ff6b6b;
        }}
        .complexity-group button.active {{
            background: #ff6b6b;
            color: #1a1a2e;
        }}
        .colorby-group button {{
            border: 2px solid #c0c0c0;
            color: #c0c0c0;
        }}
        .colorby-group button.active {{
            background: #c0c0c0;
            color: #1a1a2e;
        }}
        .colorby-group.disabled button {{
            opacity: 0.3;
            cursor: not-allowed;
            pointer-events: none;
        }}
        .people-filter {{
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 20px;
            flex-wrap: wrap;
            max-width: 1200px;
            padding-bottom: 12px;
        }}
        .filter-mode {{
            display: flex;
            align-items: center;
            gap: 4px;
            margin-right: 8px;
        }}
        .filter-mode .mode-label {{
            font-size: 12px;
            font-weight: 600;
            color: #c0c0c0;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-right: 4px;
        }}
        .filter-mode button {{
            padding: 4px 10px;
            border-radius: 4px;
            border: 2px solid #c0c0c0;
            background: transparent;
            color: #c0c0c0;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s;
        }}
        .filter-mode button.active {{
            background: #c0c0c0;
            color: #1a1a2e;
        }}
        .filter-mode button:hover {{
            opacity: 0.85;
        }}
        .person-pill {{
            padding: 5px 12px;
            border-radius: 20px;
            border: 2px solid #555;
            background: transparent;
            color: #e0e0e0;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.15s;
            display: flex;
            align-items: center;
            gap: 6px;
        }}
        .person-pill:hover {{
            border-color: #888;
        }}
        .person-pill.selected {{
            border-color: #20c40a;
            background: rgba(32, 196, 10, 0.15);
            color: #ffffff;
        }}
        .person-pill .risk-dot {{
            width: 8px;
            height: 8px;
            border-radius: 50%;
            display: inline-block;
        }}
        .pill-clear {{
            padding: 4px 10px;
            border-radius: 4px;
            border: 1px solid #555;
            background: transparent;
            color: #888;
            font-size: 11px;
            cursor: pointer;
            transition: all 0.15s;
        }}
        .pill-clear:hover {{
            color: #e0e0e0;
            border-color: #888;
        }}
        .box-b {{ color: #e94560; }}
        .box-o {{ color: #f5c518; }}
        .box-x {{ color: #2ecc71; }}
        .box-e {{ color: #e94560; }}
        .box-s {{ color: #f5c518; }}
        .people-group button.active .box-b,
        .people-group button.active .box-o,
        .people-group button.active .box-x,
        .people-group button.active .box-e,
        .people-group button.active .box-s {{
            color: #1a1a2e;
        }}
        .process-chart {{
            margin-bottom: 20px;
        }}
        svg {{
            filter: drop-shadow(0 4px 24px rgba(0,0,0,0.3));
        }}
        .box, .bar {{
            stroke: #0f3460;
            stroke-width: 1.5;
            cursor: default;
            transition: opacity 0.15s;
        }}
        .box:hover, .bar:hover {{
            opacity: 0.85;
        }}
        .line-path {{
            fill: none;
            stroke: #20c40a;
            stroke-width: 3;
        }}
        .line-dot {{
            fill: #20c40a;
            stroke: #0f3460;
            stroke-width: 1.5;
        }}
        .doc-line-path {{
            fill: none;
            stroke: #00d2ff;
            stroke-width: 3;
            stroke-dasharray: 8, 4;
        }}
        .doc-dot {{
            fill: #00d2ff;
            stroke: #0f3460;
            stroke-width: 1.5;
        }}
        .complexity-line-path {{
            fill: none;
            stroke: #ff6b6b;
            stroke-width: 3;
            stroke-dasharray: 4, 4;
        }}
        .complexity-dot {{
            fill: #ff6b6b;
            stroke: #0f3460;
            stroke-width: 1.5;
        }}
        .doc-bar {{
            fill: #00d2ff;
            stroke: #0f3460;
            stroke-width: 1.5;
        }}
        .complexity-bar {{
            fill: #ff6b6b;
            stroke: #0f3460;
            stroke-width: 1.5;
        }}
        .stage-label {{
            fill: #e0e0e0;
            font-size: 13px;
            font-weight: 500;
        }}
        .title {{
            fill: #ffffff;
            font-size: 24px;
            font-weight: 700;
            letter-spacing: 0.5px;
        }}
        .legend-label {{
            fill: #e0e0e0;
            font-size: 12px;
            font-weight: 500;
        }}
        .tooltip {{
            position: fixed;
            background: #16213e;
            border: 1px solid #e0e0e0;
            border-radius: 6px;
            padding: 8px 12px;
            color: #e0e0e0;
            font-size: 13px;
            font-weight: 500;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.1s;
            z-index: 100;
            white-space: nowrap;
        }}
        .tooltip.visible {{
            opacity: 1;
        }}
        .oncall-container {{
            padding: 20px;
            max-width: 1200px;
            width: 100%;
            margin: 0 auto;
        }}
        .oncall-header {{
            display: flex;
            align-items: center;
            gap: 16px;
            margin-bottom: 20px;
        }}
        .generate-btn {{
            padding: 10px 24px;
            border-radius: 6px;
            border: 2px solid #20c40a;
            background: #20c40a;
            color: #1a1a2e;
            font-size: 14px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.15s;
        }}
        .generate-btn:hover {{
            opacity: 0.85;
        }}
        .oncall-status {{
            color: #888;
            font-size: 13px;
        }}
        .rotation-table {{
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 24px;
        }}
        .rotation-table th {{
            background: #0f0f23;
            color: #c0c0c0;
            padding: 10px 14px;
            text-align: left;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            border-bottom: 2px solid #2a2a4a;
        }}
        .rotation-table td {{
            padding: 10px 14px;
            border-bottom: 1px solid #2a2a4a;
            color: #e0e0e0;
            font-size: 13px;
        }}
        .rotation-table tr {{
            cursor: pointer;
            transition: background 0.1s;
        }}
        .rotation-table tr:hover {{
            background: rgba(32, 196, 10, 0.08);
        }}
        .rotation-table tr.selected-week {{
            background: rgba(32, 196, 10, 0.15);
        }}
        .gap-count {{
            display: inline-block;
            min-width: 22px;
            text-align: center;
            padding: 2px 8px;
            border-radius: 10px;
            font-weight: 600;
            font-size: 12px;
        }}
        .gap-0 {{ background: #2ecc71; color: #1a1a2e; }}
        .gap-low {{ background: #f5c518; color: #1a1a2e; }}
        .gap-high {{ background: #e94560; color: #fff; }}
        .total-gaps {{
            color: #e0e0e0;
            font-size: 15px;
            font-weight: 600;
            margin: 16px 0;
        }}
        .oncall-stages-list {{
            color: #888;
            font-size: 12px;
        }}
        .week-chart-title {{
            color: #ffffff;
            font-size: 18px;
            font-weight: 700;
            margin: 24px 0 12px;
        }}
        .people-container {{
            padding: 24px;
            max-width: 1400px;
            margin: 0 auto;
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
            gap: 20px;
        }}
        .person-card {{
            background: #16213e;
            border: 1px solid #2a2a4a;
            border-radius: 10px;
            padding: 20px;
            transition: border-color 0.15s;
        }}
        .person-card:hover {{
            border-color: #4a4a6a;
        }}
        .person-card-header {{
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 12px;
        }}
        .person-card-name {{
            font-size: 18px;
            font-weight: 700;
            color: #ffffff;
        }}
        .person-card-title {{
            font-size: 13px;
            color: #888;
            margin-bottom: 10px;
        }}
        .person-card-meta {{
            display: flex;
            gap: 12px;
            margin-bottom: 14px;
            flex-wrap: wrap;
        }}
        .person-card-tag {{
            padding: 3px 10px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
        }}
        .tag-risk-low {{ background: #2ecc71; color: #1a1a2e; }}
        .tag-risk-medium {{ background: #f5c518; color: #1a1a2e; }}
        .tag-risk-high {{ background: #e94560; color: #fff; }}
        .tag-timezone {{ background: #2a2a4a; color: #c0c0c0; }}
        .person-card-process {{
            margin-bottom: 10px;
        }}
        .person-card-process-name {{
            font-size: 12px;
            font-weight: 700;
            color: #20c40a;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 6px;
        }}
        .person-card-stage {{
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 4px 0;
            font-size: 12px;
            color: #c0c0c0;
            border-bottom: 1px solid #2a2a4a;
        }}
        .person-card-stage:last-child {{
            border-bottom: none;
        }}
        .contrib-badge {{
            padding: 2px 8px;
            border-radius: 8px;
            font-size: 10px;
            font-weight: 600;
        }}
        .contrib-owner {{ background: #4a9eff; color: #fff; }}
        .contrib-contributor {{ background: #2a2a4a; color: #c0c0c0; }}
        .contrib-learner {{ background: transparent; border: 1px solid #20c40a; color: #20c40a; }}
        .card-edit-btn {{
            padding: 4px 12px;
            border-radius: 5px;
            border: 1px solid #555;
            background: transparent;
            color: #888;
            font-size: 11px;
            cursor: pointer;
            transition: all 0.15s;
        }}
        .card-edit-btn:hover {{
            color: #e0e0e0;
            border-color: #888;
        }}
        .card-edit-btn.saving {{
            color: #20c40a;
            border-color: #20c40a;
        }}
        .card-field {{
            width: 100%;
            background: #1a1a2e;
            border: 1px solid #2a2a4a;
            border-radius: 4px;
            color: #e0e0e0;
            padding: 4px 8px;
            font-size: 12px;
            font-family: inherit;
        }}
        .card-field:focus {{
            outline: none;
            border-color: #20c40a;
        }}
        .card-field-select {{
            width: 100%;
            background: #1a1a2e;
            border: 1px solid #2a2a4a;
            border-radius: 4px;
            color: #e0e0e0;
            padding: 4px 8px;
            font-size: 12px;
            font-family: inherit;
            cursor: pointer;
        }}
        .card-field-select:focus {{
            outline: none;
            border-color: #20c40a;
        }}
        .card-saved-msg {{
            color: #20c40a;
            font-size: 11px;
            opacity: 0;
            transition: opacity 0.2s;
        }}
        .card-saved-msg.show {{
            opacity: 1;
        }}
        .card-add-btn {{
            padding: 4px 10px;
            border-radius: 5px;
            border: 1px dashed #555;
            background: transparent;
            color: #888;
            font-size: 11px;
            cursor: pointer;
            transition: all 0.15s;
            margin-top: 6px;
        }}
        .card-add-btn:hover {{
            color: #20c40a;
            border-color: #20c40a;
        }}
        .card-delete-btn {{
            padding: 2px 6px;
            border: none;
            background: transparent;
            color: #555;
            font-size: 14px;
            cursor: pointer;
            transition: color 0.15s;
            line-height: 1;
        }}
        .card-delete-btn:hover {{
            color: #e94560;
        }}
        .add-person-card {{
            background: transparent;
            border: 2px dashed #2a2a4a;
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 200px;
            cursor: pointer;
            transition: all 0.15s;
            color: #555;
            font-size: 15px;
            font-weight: 600;
        }}
        .add-person-card:hover {{
            border-color: #20c40a;
            color: #20c40a;
        }}
        .card-delete-person {{
            padding: 4px 10px;
            border-radius: 5px;
            border: 1px solid #555;
            background: transparent;
            color: #555;
            font-size: 11px;
            cursor: pointer;
            transition: all 0.15s;
        }}
        .card-delete-person:hover {{
            color: #e94560;
            border-color: #e94560;
        }}
        .stage-detail-row {{
            padding: 10px;
            margin-bottom: 8px;
            background: #1a1a2e;
            border: 1px solid #2a2a4a;
            border-radius: 6px;
        }}
        .stage-detail-header {{
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 6px;
        }}
        .stage-order-btns {{
            display: flex;
            flex-direction: column;
            gap: 0;
            margin-right: 6px;
        }}
        .stage-order-btn {{
            padding: 0 4px;
            border: none;
            background: transparent;
            color: #555;
            font-size: 12px;
            cursor: pointer;
            line-height: 1.1;
            transition: color 0.15s;
        }}
        .stage-order-btn:hover {{
            color: #20c40a;
        }}
        .stage-order-btn:disabled {{
            opacity: 0.2;
            cursor: default;
        }}
        .stage-detail-header input {{
            font-size: 14px;
            font-weight: 600;
            color: #fff;
        }}
        .stage-detail-fields {{
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px;
        }}
        .stage-detail-fields label {{
            font-size: 10px;
            color: #888;
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }}
        .stage-detail-fields .field-group {{
            display: flex;
            flex-direction: column;
            gap: 2px;
        }}
        .stage-comment-field {{
            width: 100%;
            background: #1a1a2e;
            border: 1px solid #2a2a4a;
            border-radius: 4px;
            color: #c0c0c0;
            padding: 6px 8px;
            font-size: 11px;
            font-family: inherit;
            resize: vertical;
            min-height: 50px;
            margin-top: 6px;
        }}
        .stage-comment-field:focus {{
            outline: none;
            border-color: #20c40a;
        }}
    </style>
</head>
<body>
    <nav class="navbar">
        <span class="brand"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#20c40a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -3px; margin-right: 6px;"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>BoxOps</span>
        <button class="nav-tab active" data-view="knowledge-coverage">Knowledge Coverage</button>
        <button class="nav-tab" data-view="oncall-rotation">On-Call Rotation</button>
        <button class="nav-tab" data-view="people">People</button>
        <button class="nav-tab" data-view="processes">Processes</button>
    </nav>
    <div id="knowledge-view">
    <div class="sticky-header">
    <div class="controls">
        <div class="control-group people-group">
            <span class="group-label">People</span>
            <button data-mode="off">Off</button>
            <button class="active" data-mode="boxes"><span class="box-b">B</span><span class="box-o">o</span><span class="box-x">x</span><span class="box-e">e</span><span class="box-s">s</span></button>
            <button data-mode="bar">Bar</button>
            <button data-mode="line">Line</button>
        </div>
        <div class="control-group colorby-group">
            <span class="group-label">Color By</span>
            <button data-colortoggle="risk">Flight Risk</button>
            <button data-colortoggle="contributor">Contributor Level</button>
        </div>
        <div class="control-group doc-group">
            <span class="group-label">Doc Coverage Score</span>
            <button data-overlay="doc" data-val="off" class="active">Off</button>
            <button data-overlay="doc" data-val="line">Line</button>
            <button data-overlay="doc" data-val="bar">Bar</button>
        </div>
        <div class="control-group complexity-group">
            <span class="group-label">Complexity Score</span>
            <button data-overlay="complexity" data-val="off" class="active">Off</button>
            <button data-overlay="complexity" data-val="line">Line</button>
            <button data-overlay="complexity" data-val="bar">Bar</button>
        </div>
        <label style="display:flex;align-items:center;gap:6px;color:#c0c0c0;font-size:12px;font-weight:600;cursor:pointer;user-select:none;">
            <input type="checkbox" id="oncall-only-toggle"> On-Call Only
        </label>
    </div>
    <div class="people-filter" id="people-filter"></div>
    </div>
    <div id="knowledge-charts"></div>
    </div>
    <div id="oncall-view" style="display:none;">
        <div class="oncall-container">
            <div class="oncall-header">
                <button id="generate-btn" class="generate-btn">Generate Optimal Rotation</button>
                <span id="oncall-status" class="oncall-status"></span>
            </div>
            <div id="oncall-results"></div>
            <div id="oncall-week-chart"></div>
        </div>
    </div>
    <div id="people-view" style="display:none;">
        <div class="people-container" id="people-cards"></div>
    </div>
    <div id="processes-view" style="display:none;">
        <div class="people-container" id="process-cards"></div>
    </div>
    <div class="tooltip" id="tooltip"></div>
    <script>
        const processes = {data_json};
        const allPeople = {people_summary_json};
        const allPeopleFull = {people_full_json};
        const allRawProcesses = {raw_processes_json};
        const tooltip = document.getElementById('tooltip');

        const margin = {{ top: 80, right: 200, bottom: 160, left: 50 }};
        const boxSize = 64;
        const boxGap = 4;
        const colWidth = 76;

        const riskColors = {{ high: '#e94560', medium: '#f5c518', low: '#2ecc71' }};
        const riskOrder = {{ low: 0, medium: 1, high: 2 }};

        const contribColors = {{ Owner: '#20c40a', Contributor: '#20c40a', Learner: 'transparent' }};
        const contribBorder = {{ Owner: '#4a9eff', Contributor: '#0f3460', Learner: '#20c40a' }};
        const contribOrder = {{ Learner: 0, Contributor: 1, Owner: 2 }};

        let currentMode = 'boxes';
        let showRisk = false;
        let showContributor = false;
        let docMode = 'off';
        let complexityMode = 'off';
        let filterMode = 'spotlight';  // 'spotlight' or 'whatifout'
        let onCallOnly = false;
        let selectedPeople = new Set();

        const charts = [];

        // Build people filter bar
        const filterContainer = document.getElementById('people-filter');
        const modeDiv = document.createElement('div');
        modeDiv.className = 'filter-mode';
        modeDiv.innerHTML = `<span class="mode-label">Filter</span>
            <button class="active" data-filtermode="spotlight">Spotlight</button>
            <button data-filtermode="whatifout">What If Out</button>`;
        filterContainer.appendChild(modeDiv);

        allPeople.forEach(p => {{
            const pill = document.createElement('button');
            pill.className = 'person-pill';
            pill.dataset.name = p.name;
            pill.innerHTML = `<span class="risk-dot" style="background:${{riskColors[p.flight_risk]}}"></span>${{p.name}}`;
            pill.addEventListener('click', () => {{
                if (selectedPeople.has(p.name)) {{
                    selectedPeople.delete(p.name);
                    pill.classList.remove('selected');
                }} else {{
                    selectedPeople.add(p.name);
                    pill.classList.add('selected');
                }}
                redrawAll();
            }});
            filterContainer.appendChild(pill);
        }});

        const clearBtn = document.createElement('button');
        clearBtn.className = 'pill-clear';
        clearBtn.textContent = 'Clear';
        clearBtn.addEventListener('click', () => {{
            selectedPeople.clear();
            filterContainer.querySelectorAll('.person-pill').forEach(p => p.classList.remove('selected'));
            redrawAll();
        }});
        filterContainer.appendChild(clearBtn);

        modeDiv.querySelectorAll('button[data-filtermode]').forEach(btn => {{
            btn.addEventListener('click', () => {{
                filterMode = btn.dataset.filtermode;
                modeDiv.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.filtermode === filterMode));
                redrawAll();
            }});
        }});

        function getFilteredPeople(stagePeople) {{
            if (selectedPeople.size === 0) return stagePeople;
            if (filterMode === 'spotlight') {{
                return stagePeople.filter(p => selectedPeople.has(p.name));
            }} else {{
                return stagePeople.filter(p => !selectedPeople.has(p.name));
            }}
        }}

        function redrawAll() {{
            charts.forEach(ref => {{
                if (currentMode === 'boxes') drawBoxes(ref);
                if (currentMode === 'bar') drawAllBars(ref);
                if (currentMode === 'line') drawLine(ref);
                drawDocCoverage(ref, docMode);
                drawComplexity(ref, complexityMode);
            }});
            updateLegends();
        }}

        function buildCharts() {{
        charts.length = 0;
        d3.select('#knowledge-charts').selectAll('*').remove();
        processes.forEach((proc) => {{
            const data = onCallOnly ? proc.stages.filter(s => s.on_call) : proc.stages;
            if (data.length === 0) return;
            const width = data.length * colWidth + margin.left + margin.right;
            const maxCount = Math.max(...data.map(d => d.count), 1);
            const chartHeight = maxCount * (boxSize + boxGap);
            const height = chartHeight + margin.top + margin.bottom;
            const chartWidth = data.length * colWidth;

            const container = d3.select('#knowledge-charts')
                .append('div')
                .attr('class', 'process-chart');

            const svg = container
                .append('svg')
                .attr('width', '100%')
                .attr('height', height)
                .attr('viewBox', `0 0 ${{width}} ${{height}}`);

            const zoomGroup = svg.append('g');
            svg.call(d3.zoom()
                .scaleExtent([0.3, 5])
                .on('zoom', (event) => {{
                    zoomGroup.attr('transform', event.transform);
                }}));

            zoomGroup.append('text')
                .attr('class', 'title')
                .attr('x', margin.left + chartWidth / 2)
                .attr('y', 32)
                .attr('text-anchor', 'middle')
                .text(proc.name + ' — Knowledge Coverage');

            const chart = zoomGroup.append('g')
                .attr('transform', `translate(${{margin.left}}, ${{margin.top}})`);

            const yLeft = d3.scaleLinear()
                .domain([0, maxCount])
                .range([chartHeight, 0]);
            for (let t = 0; t <= maxCount; t++) {{
                chart.append('text')
                    .attr('x', -10).attr('y', yLeft(t) + 4)
                    .attr('text-anchor', 'end')
                    .attr('fill', '#20c40a')
                    .attr('font-size', '12px')
                    .text(t);
            }}
            chart.append('text')
                .attr('x', -10).attr('y', -12)
                .attr('text-anchor', 'end')
                .attr('fill', '#20c40a')
                .attr('font-size', '11px')
                .text('People');

            const yRight = d3.scaleLinear()
                .domain([0, 5])
                .range([chartHeight, 0]);
            for (let t = 0; t <= 5; t++) {{
                chart.append('text')
                    .attr('x', chartWidth + 10).attr('y', yRight(t) + 4)
                    .attr('text-anchor', 'start')
                    .attr('fill', '#00d2ff')
                    .attr('font-size', '12px')
                    .text(t);
            }}
            chart.append('text')
                .attr('x', chartWidth + 10).attr('y', -12)
                .attr('text-anchor', 'start')
                .attr('fill', '#00d2ff')
                .attr('font-size', '11px')
                .text('Score (1-5)');

            data.forEach((stage, i) => {{
                chart.append('text')
                    .attr('class', 'stage-label')
                    .attr('x', i * colWidth + colWidth / 2)
                    .attr('y', chartHeight + 20)
                    .attr('text-anchor', 'start')
                    .attr('transform', `rotate(45, ${{i * colWidth + colWidth / 2}}, ${{chartHeight + 20}})`)
                    .text(stage.name);
            }});

            const boxesGroup = chart.append('g');
            const barGroup = chart.append('g');
            const docBarGroup = chart.append('g').attr('display', 'none');
            const complexityBarGroup = chart.append('g').attr('display', 'none');
            const lineGroup = chart.append('g');
            const docLineGroup = chart.append('g').attr('display', 'none');
            const complexityLineGroup = chart.append('g').attr('display', 'none');

            const legendGroup = chart.append('g')
                .attr('transform', `translate(${{chartWidth + 40}}, 10)`);

            charts.push({{ data, chartHeight, chartWidth, colWidth, boxSize, boxGap,
                yLeft, yRight, boxesGroup, barGroup, lineGroup,
                docBarGroup, docLineGroup, complexityBarGroup, complexityLineGroup,
                legendGroup }});
        }});
        }}
        buildCharts();

        function drawBoxes(ref) {{
            ref.boxesGroup.selectAll('*').remove();
            ref.data.forEach((stage, i) => {{
                const x = i * ref.colWidth + (ref.colWidth - ref.boxSize) / 2;
                const filtered = getFilteredPeople(stage.people);
                const sorted = [...filtered].sort((a, b) => riskOrder[a.flight_risk] - riskOrder[b.flight_risk]);
                sorted.forEach((person, j) => {{
                    const y = ref.chartHeight - (j + 1) * (ref.boxSize + ref.boxGap);
                    const level = person.contributor_level || 'Contributor';
                    const risk = person.flight_risk || 'low';

                    // Determine fill
                    let fill = '#20c40a';
                    if (showContributor && level === 'Learner') {{
                        fill = 'transparent';
                    }} else if (showRisk) {{
                        fill = riskColors[risk] || '#f5c518';
                    }}

                    // Determine stroke
                    let stroke = '#0f3460';
                    let strokeWidth = '1.5px';
                    let strokeInset = false;
                    if (showContributor) {{
                        if (level === 'Owner') {{
                            stroke = '#4a9eff';
                            strokeWidth = '5px';
                            strokeInset = true;
                        }} else if (level === 'Learner') {{
                            stroke = showRisk ? riskColors[risk] : '#20c40a';
                            strokeWidth = '4px';
                            strokeInset = true;
                        }}
                    }}

                    // Tooltip text
                    const parts = [person.name];
                    if (showContributor) parts.push(level);
                    if (showRisk) parts.push(risk + ' risk');

                    ref.boxesGroup.append('rect')
                        .attr('class', 'box')
                        .attr('x', x).attr('y', y)
                        .attr('width', ref.boxSize).attr('height', ref.boxSize)
                        .attr('rx', 4)
                        .attr('fill', fill)
                        .style('stroke', strokeInset ? 'none' : stroke)
                        .style('stroke-width', strokeInset ? '0' : strokeWidth)
                        .style('cursor', 'pointer')
                        .on('mouseover', (event) => {{
                            tooltip.textContent = parts.join(' — ');
                            tooltip.classList.add('visible');
                        }})
                        .on('mousemove', (event) => {{
                            tooltip.style.left = (event.clientX + 12) + 'px';
                            tooltip.style.top = (event.clientY - 10) + 'px';
                        }})
                        .on('mouseout', () => {{
                            tooltip.classList.remove('visible');
                        }});
                    // Draw inset border on top
                    if (strokeInset) {{
                        const sw = parseFloat(strokeWidth);
                        const half = sw / 2;
                        ref.boxesGroup.append('rect')
                            .attr('x', x + half).attr('y', y + half)
                            .attr('width', ref.boxSize - sw).attr('height', ref.boxSize - sw)
                            .attr('rx', 3)
                            .attr('fill', 'none')
                            .style('stroke', stroke)
                            .style('stroke-width', strokeWidth)
                            .style('stroke-dasharray', '4,3')
                            .attr('pointer-events', 'none');
                    }}
                }});
            }});
        }}

        function drawLine(ref) {{
            ref.lineGroup.selectAll('*').remove();
            const points = ref.data.map((stage, i) => ({{
                x: i * ref.colWidth + ref.colWidth / 2,
                y: ref.chartHeight - getFilteredPeople(stage.people).length * (ref.boxSize + ref.boxGap),
            }}));
            const line = d3.line().x(d => d.x).y(d => d.y).curve(d3.curveMonotoneX);
            ref.lineGroup.append('path').attr('class', 'line-path').attr('d', line(points));
            points.forEach(p => {{
                ref.lineGroup.append('circle').attr('class', 'line-dot')
                    .attr('cx', p.x).attr('cy', p.y).attr('r', 6);
            }});
        }}

        function drawOverlayLine(ref, group, data, key, pathClass, dotClass) {{
            group.selectAll('*').remove();
            const points = data.map((stage, i) => ({{
                x: i * ref.colWidth + ref.colWidth / 2,
                y: ref.yRight(stage[key]),
            }}));
            const line = d3.line().x(d => d.x).y(d => d.y).curve(d3.curveMonotoneX);
            group.append('path').attr('class', pathClass).attr('d', line(points));
            points.forEach(p => {{
                group.append('circle').attr('class', dotClass)
                    .attr('cx', p.x).attr('cy', p.y).attr('r', 6);
            }});
        }}

        function getActiveBarSeries() {{
            const series = [];
            if (currentMode === 'bar') series.push({{ key: 'count', scale: 'left', cls: 'bar', fill: '#20c40a', group: 'barGroup' }});
            if (docMode === 'bar') series.push({{ key: 'doc_coverage', scale: 'right', cls: 'doc-bar', fill: null, group: 'docBarGroup' }});
            if (complexityMode === 'bar') series.push({{ key: 'complexity', scale: 'right', cls: 'complexity-bar', fill: null, group: 'complexityBarGroup' }});
            return series;
        }}

        function drawAllBars(ref) {{
            const series = getActiveBarSeries();
            const totalBars = series.length;
            const maxBarWidth = ref.boxSize;
            const barWidth = totalBars > 0 ? Math.min(maxBarWidth, (ref.colWidth - 8) / totalBars) : maxBarWidth;
            const totalGroupWidth = barWidth * totalBars;

            series.forEach((s, sIdx) => {{
                const group = ref[s.group];
                group.selectAll('*').remove();
                ref.data.forEach((stage, i) => {{
                    const val = s.key === 'count' ? getFilteredPeople(stage.people).length : stage[s.key];
                    const bh = s.scale === 'left'
                        ? val * (ref.boxSize + ref.boxGap)
                        : ref.chartHeight - ref.yRight(val);
                    const groupStart = i * ref.colWidth + (ref.colWidth - totalGroupWidth) / 2;
                    const x = groupStart + sIdx * barWidth;
                    const y = ref.chartHeight - bh;
                    const rect = group.append('rect')
                        .attr('class', s.cls)
                        .attr('x', x).attr('y', y)
                        .attr('width', barWidth - 2).attr('height', bh)
                        .attr('rx', 3);
                    if (s.fill) rect.attr('fill', s.fill);
                }});
            }});
        }}

        function drawNarrowOverlayBars(ref) {{
            const narrowWidth = 8;
            const activeOverlays = [];
            if (docMode === 'bar') activeOverlays.push({{ key: 'doc_coverage', cls: 'doc-bar', group: 'docBarGroup' }});
            if (complexityMode === 'bar') activeOverlays.push({{ key: 'complexity', cls: 'complexity-bar', group: 'complexityBarGroup' }});

            const totalWidth = activeOverlays.length * narrowWidth + (activeOverlays.length - 1) * 2;

            activeOverlays.forEach((overlay, oIdx) => {{
                const group = ref[overlay.group];
                group.selectAll('*').remove();
                ref.data.forEach((stage, i) => {{
                    const val = stage[overlay.key];
                    const bh = ref.chartHeight - ref.yRight(val);
                    const colCenter = i * ref.colWidth + ref.colWidth / 2;
                    const groupStart = colCenter - totalWidth / 2;
                    const x = groupStart + oIdx * (narrowWidth + 2);
                    const y = ref.chartHeight - bh;
                    group.append('rect')
                        .attr('class', overlay.cls)
                        .attr('x', x).attr('y', y)
                        .attr('width', narrowWidth).attr('height', bh)
                        .attr('rx', 2);
                }});
            }});
        }}

        function drawDocCoverage(ref, mode) {{
            ref.docBarGroup.selectAll('*').remove();
            ref.docLineGroup.selectAll('*').remove();
            ref.docBarGroup.attr('display', 'none');
            ref.docLineGroup.attr('display', 'none');
            if (mode === 'line') {{
                ref.docLineGroup.attr('display', null);
                drawOverlayLine(ref, ref.docLineGroup, ref.data, 'doc_coverage', 'doc-line-path', 'doc-dot');
            }}
            if (mode === 'bar') {{
                ref.docBarGroup.attr('display', null);
                if (currentMode === 'boxes') {{
                    drawNarrowOverlayBars(ref);
                }} else {{
                    drawAllBars(ref);
                }}
            }}
        }}

        function drawComplexity(ref, mode) {{
            ref.complexityBarGroup.selectAll('*').remove();
            ref.complexityLineGroup.selectAll('*').remove();
            ref.complexityBarGroup.attr('display', 'none');
            ref.complexityLineGroup.attr('display', 'none');
            if (mode === 'line') {{
                ref.complexityLineGroup.attr('display', null);
                drawOverlayLine(ref, ref.complexityLineGroup, ref.data, 'complexity', 'complexity-line-path', 'complexity-dot');
            }}
            if (mode === 'bar') {{
                ref.complexityBarGroup.attr('display', null);
                if (currentMode === 'boxes') {{
                    drawNarrowOverlayBars(ref);
                }} else {{
                    drawAllBars(ref);
                }}
            }}
        }}

        function updateLegends() {{
            charts.forEach(ref => {{
                ref.legendGroup.selectAll('*').remove();
                const items = [];

                if (currentMode === 'boxes') {{
                    if (showRisk) {{
                        items.push({{ color: '#2ecc71', label: 'Low Risk', type: 'rect' }});
                        items.push({{ color: '#f5c518', label: 'Medium Risk', type: 'rect' }});
                        items.push({{ color: '#e94560', label: 'High Risk', type: 'rect' }});
                    }}
                    if (showContributor) {{
                        items.push({{ color: showRisk ? '#888' : '#20c40a', label: 'Owner (blue border)', type: 'rect', border: '#4a9eff' }});
                        items.push({{ color: showRisk ? '#888' : '#20c40a', label: 'Contributor', type: 'rect' }});
                        items.push({{ color: 'transparent', label: 'Learner (outline only)', type: 'rect', border: showRisk ? '#888' : '#20c40a' }});
                    }}
                }} else if (currentMode === 'bar') {{
                    items.push({{ color: '#20c40a', label: 'People (Bar)', type: 'rect' }});
                }} else if (currentMode === 'line') {{
                    items.push({{ color: '#20c40a', label: 'People (Line)', type: 'line' }});
                }}

                if (docMode === 'line') {{
                    items.push({{ color: '#00d2ff', label: 'Doc Coverage Score (Line)', type: 'line', dashed: true }});
                }} else if (docMode === 'bar') {{
                    items.push({{ color: '#00d2ff', label: 'Doc Coverage Score (Bar)', type: 'rect' }});
                }}

                if (complexityMode === 'line') {{
                    items.push({{ color: '#ff6b6b', label: 'Complexity Score (Line)', type: 'line', dashed: true }});
                }} else if (complexityMode === 'bar') {{
                    items.push({{ color: '#ff6b6b', label: 'Complexity Score (Bar)', type: 'rect' }});
                }}

                items.forEach((item, idx) => {{
                    const y = idx * 22;
                    if (item.type === 'rect') {{
                        const r = ref.legendGroup.append('rect')
                            .attr('x', 0).attr('y', y)
                            .attr('width', 14).attr('height', 14)
                            .attr('rx', 2)
                            .attr('fill', item.color);
                        if (item.border) r.attr('stroke', item.border).attr('stroke-width', 2);
                    }} else {{
                        ref.legendGroup.append('line')
                            .attr('x1', 0).attr('y1', y + 7)
                            .attr('x2', 14).attr('y2', y + 7)
                            .attr('stroke', item.color)
                            .attr('stroke-width', 3)
                            .attr('stroke-dasharray', item.dashed ? '4,3' : 'none');
                        ref.legendGroup.append('circle')
                            .attr('cx', 7).attr('cy', y + 7).attr('r', 3)
                            .attr('fill', item.color);
                    }}
                    ref.legendGroup.append('text')
                        .attr('class', 'legend-label')
                        .attr('x', 20).attr('y', y + 11)
                        .text(item.label);
                }});
            }});
        }}

        function setMode(mode) {{
            currentMode = mode;
            charts.forEach(ref => {{
                ref.boxesGroup.attr('display', mode === 'boxes' ? null : 'none');
                ref.barGroup.attr('display', mode === 'bar' ? null : 'none');
                ref.lineGroup.attr('display', mode === 'line' ? null : 'none');
                if (mode === 'off') {{
                    ref.boxesGroup.selectAll('*').remove();
                    ref.barGroup.selectAll('*').remove();
                    ref.lineGroup.selectAll('*').remove();
                }}
                if (mode === 'boxes') drawBoxes(ref);
                if (mode === 'bar') drawAllBars(ref);
                if (mode === 'line') drawLine(ref);
                drawDocCoverage(ref, docMode);
                drawComplexity(ref, complexityMode);
            }});
            document.querySelectorAll('.people-group button[data-mode]').forEach(btn => {{
                btn.classList.toggle('active', btn.dataset.mode === mode);
            }});
            const colorbyGroup = document.querySelector('.colorby-group');
            if (mode === 'boxes') {{
                colorbyGroup.classList.remove('disabled');
            }} else {{
                colorbyGroup.classList.add('disabled');
            }}
            updateLegends();
        }}

        document.querySelectorAll('.people-group button[data-mode]').forEach(btn => {{
            btn.addEventListener('click', () => setMode(btn.dataset.mode));
        }});

        // Color By toggles (independent, can both be on)
        document.querySelectorAll('.colorby-group button[data-colortoggle]').forEach(btn => {{
            btn.addEventListener('click', () => {{
                const which = btn.dataset.colortoggle;
                if (which === 'risk') showRisk = !showRisk;
                if (which === 'contributor') showContributor = !showContributor;
                btn.classList.toggle('active');
                if (currentMode === 'boxes') {{
                    charts.forEach(ref => drawBoxes(ref));
                }}
                updateLegends();
            }});
        }});

        function setOverlay(overlay, val) {{
            if (overlay === 'doc') docMode = val;
            if (overlay === 'complexity') complexityMode = val;

            document.querySelectorAll(`button[data-overlay="${{overlay}}"]`).forEach(btn => {{
                btn.classList.toggle('active', btn.dataset.val === val);
            }});

            charts.forEach(ref => {{
                drawDocCoverage(ref, docMode);
                drawComplexity(ref, complexityMode);
                if (currentMode === 'bar') drawAllBars(ref);
            }});
            updateLegends();
        }}

        document.querySelectorAll('button[data-overlay]').forEach(btn => {{
            btn.addEventListener('click', () => setOverlay(btn.dataset.overlay, btn.dataset.val));
        }});

        document.getElementById('oncall-only-toggle').addEventListener('change', (e) => {{
            onCallOnly = e.target.checked;
            buildCharts();
            setMode(currentMode);
        }});

        setMode('boxes');

        // ===== View switching =====
        document.querySelectorAll('.nav-tab[data-view]').forEach(tab => {{
            tab.addEventListener('click', () => {{
                document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const view = tab.dataset.view;
                document.getElementById('knowledge-view').style.display = view === 'knowledge-coverage' ? '' : 'none';
                document.getElementById('oncall-view').style.display = view === 'oncall-rotation' ? '' : 'none';
                document.getElementById('people-view').style.display = view === 'people' ? '' : 'none';
                document.getElementById('processes-view').style.display = view === 'processes' ? '' : 'none';
                if (view === 'people') renderPeopleCards();
                if (view === 'processes') renderProcessCards();
            }});
        }});

        // ===== On-Call Rotation =====
        // Collect all on_call stages across all processes
        function getOnCallStages() {{
            const stages = [];
            processes.forEach(proc => {{
                proc.stages.forEach(stage => {{
                    if (stage.on_call) {{
                        stages.push({{ process: proc.name, id: stage.id, name: stage.name }});
                    }}
                }});
            }});
            return stages;
        }}

        // Build coverage map: for each person, which on_call stage ids they cover
        function buildPersonCoverage() {{
            const coverage = {{}};
            processes.forEach(proc => {{
                proc.stages.forEach(stage => {{
                    if (!stage.on_call) return;
                    stage.people.forEach(person => {{
                        if (!coverage[person.name]) coverage[person.name] = new Set();
                        coverage[person.name].add(stage.id);
                    }});
                }});
            }});
            return coverage;
        }}

        // Count gaps for a primary+backup pair
        function countGaps(primaryName, backupName, personCoverage, onCallStageIds) {{
            const covered = new Set();
            (personCoverage[primaryName] || new Set()).forEach(s => covered.add(s));
            (personCoverage[backupName] || new Set()).forEach(s => covered.add(s));
            let gaps = 0;
            const uncovered = [];
            onCallStageIds.forEach(sid => {{
                if (!covered.has(sid)) {{
                    gaps++;
                    uncovered.push(sid);
                }}
            }});
            return {{ gaps, uncovered }};
        }}

        // Solve assignment problem using branch-and-bound
        // Given cost matrix NxN, find permutation p minimizing sum(cost[i][p[i]])
        // with constraint p[i] != i (no self-pairing)
        function solveAssignment(costMatrix) {{
            const N = costMatrix.length;
            const used = new Array(N).fill(false);
            const bestAssignment = new Array(N).fill(-1);
            let bestCost = Infinity;
            let evaluated = 0;

            function solve(row, currentCost, assignment) {{
                if (currentCost >= bestCost) return;
                if (row === N) {{
                    evaluated++;
                    bestCost = currentCost;
                    for (let i = 0; i < N; i++) bestAssignment[i] = assignment[i];
                    return;
                }}
                // Try candidates sorted by cost for better pruning
                const candidates = [];
                for (let b = 0; b < N; b++) {{
                    if (!used[b] && b !== row) candidates.push(b);
                }}
                candidates.sort((a, b) => costMatrix[row][a] - costMatrix[row][b]);
                for (const b of candidates) {{
                    used[b] = true;
                    assignment[row] = b;
                    solve(row + 1, currentCost + costMatrix[row][b], assignment);
                    used[b] = false;
                }}
            }}
            solve(0, 0, new Array(N));
            return {{ assignment: bestAssignment, cost: bestCost, evaluated }};
        }}

        function generateRotation() {{
            const statusEl = document.getElementById('oncall-status');
            const resultsEl = document.getElementById('oncall-results');
            const weekChartEl = document.getElementById('oncall-week-chart');
            statusEl.textContent = 'Computing...';
            resultsEl.innerHTML = '';
            weekChartEl.innerHTML = '';

            setTimeout(() => {{
                const onCallStages = getOnCallStages();
                const onCallStageIds = onCallStages.map(s => s.id);
                const personCoverage = buildPersonCoverage();
                const names = allPeople.map(p => p.name);
                const N = names.length;

                // Build cost matrix
                const costMatrix = [];
                for (let i = 0; i < N; i++) {{
                    costMatrix[i] = [];
                    for (let j = 0; j < N; j++) {{
                        if (i === j) {{
                            costMatrix[i][j] = 9999;
                        }} else {{
                            costMatrix[i][j] = countGaps(names[i], names[j], personCoverage, onCallStageIds).gaps;
                        }}
                    }}
                }}

                const result = solveAssignment(costMatrix);

                // Build rotation schedule
                const weeks = [];
                for (let i = 0; i < N; i++) {{
                    const primary = names[i];
                    const backup = names[result.assignment[i]];
                    const gapInfo = countGaps(primary, backup, personCoverage, onCallStageIds);
                    weeks.push({{ week: i + 1, primary, backup, gaps: gapInfo.gaps, uncovered: gapInfo.uncovered }});
                }}

                const totalGaps = weeks.reduce((s, w) => s + w.gaps, 0);
                statusEl.textContent = `Evaluated ${{result.evaluated.toLocaleString()}} complete permutations — optimal rotation found.`;

                // Build stage name lookup
                const stageNameMap = {{}};
                onCallStages.forEach(s => stageNameMap[s.id] = s.name);

                // Render table
                let html = `<div class="total-gaps">Total gaps across rotation: ${{totalGaps}} (across ${{onCallStageIds.length}} on-call stages per week)</div>`;
                html += `<table class="rotation-table"><thead><tr>
                    <th>Week</th><th>Primary</th><th>Backup</th><th>Gaps</th><th>Uncovered Stages</th>
                </tr></thead><tbody>`;
                weeks.forEach(w => {{
                    const gapClass = w.gaps === 0 ? 'gap-0' : w.gaps <= 2 ? 'gap-low' : 'gap-high';
                    const uncoveredNames = w.uncovered.map(id => stageNameMap[id] || id).join(', ') || '—';
                    html += `<tr data-week="${{w.week - 1}}">
                        <td>Week ${{w.week}}</td>
                        <td>${{w.primary}}</td>
                        <td>${{w.backup}}</td>
                        <td><span class="gap-count ${{gapClass}}">${{w.gaps}}</span></td>
                        <td class="oncall-stages-list">${{uncoveredNames}}</td>
                    </tr>`;
                }});
                html += `</tbody></table>`;
                resultsEl.innerHTML = html;

                // Render all week coverage charts
                renderAllWeekCharts(weeks);
            }}, 10);
        }}

        function renderAllWeekCharts(weeks) {{
            const el = document.getElementById('oncall-week-chart');
            el.innerHTML = '';

            const wcBoxSize = 72;
            const wcBoxGap = 5;
            const wcColWidth = 90;
            const wcMargin = {{ top: 70, right: 160, bottom: 130, left: 50 }};

            weeks.forEach(week => {{
                const weekDiv = document.createElement('div');
                weekDiv.className = 'process-chart';
                el.appendChild(weekDiv);

                const pairNames = new Set([week.primary, week.backup]);

                // Render each process for this week
                processes.forEach(proc => {{
                    const data = proc.stages;
                    const filteredData = data.map(stage => {{
                        const filtered = stage.people.filter(p => pairNames.has(p.name));
                        return {{ ...stage, filteredPeople: filtered, filteredCount: filtered.length }};
                    }});

                    const maxCount = Math.max(...filteredData.map(d => d.filteredCount), 1);
                    const chartWidth = data.length * wcColWidth;
                    const chartHeight = maxCount * (wcBoxSize + wcBoxGap);
                    const width = chartWidth + wcMargin.left + wcMargin.right;
                    const height = chartHeight + wcMargin.top + wcMargin.bottom;

                    const svg = d3.select(weekDiv).append('svg')
                        .attr('width', '100%')
                        .attr('height', height)
                        .attr('viewBox', `0 0 ${{width}} ${{height}}`);

                    // Title
                    svg.append('text')
                        .attr('class', 'title')
                        .attr('x', wcMargin.left + chartWidth / 2)
                        .attr('y', 28)
                        .attr('text-anchor', 'middle')
                        .attr('fill', '#fff')
                        .attr('font-size', '18px')
                        .attr('font-weight', '700')
                        .text(`Week ${{week.week}}: ${{week.primary}} + ${{week.backup}} — ${{proc.name}}`);

                    const chart = svg.append('g')
                        .attr('transform', `translate(${{wcMargin.left}}, ${{wcMargin.top}})`);

                    // Left Y axis (people count)
                    const yLeft = d3.scaleLinear().domain([0, maxCount]).range([chartHeight, 0]);
                    for (let t = 0; t <= maxCount; t++) {{
                        chart.append('text')
                            .attr('x', -10).attr('y', yLeft(t) + 4)
                            .attr('text-anchor', 'end')
                            .attr('fill', '#20c40a')
                            .attr('font-size', '11px')
                            .text(t);
                    }}
                    chart.append('text')
                        .attr('x', -10).attr('y', -10)
                        .attr('text-anchor', 'end')
                        .attr('fill', '#20c40a')
                        .attr('font-size', '10px')
                        .text('People');

                    // Right Y axis (score 1-5)
                    const yRight = d3.scaleLinear().domain([0, 5]).range([chartHeight, 0]);
                    for (let t = 0; t <= 5; t++) {{
                        chart.append('text')
                            .attr('x', chartWidth + 10).attr('y', yRight(t) + 4)
                            .attr('text-anchor', 'start')
                            .attr('fill', '#00d2ff')
                            .attr('font-size', '11px')
                            .text(t);
                    }}
                    chart.append('text')
                        .attr('x', chartWidth + 10).attr('y', -10)
                        .attr('text-anchor', 'start')
                        .attr('fill', '#00d2ff')
                        .attr('font-size', '10px')
                        .text('Score');

                    // Stage labels
                    filteredData.forEach((stage, i) => {{
                        chart.append('text')
                            .attr('class', 'stage-label')
                            .attr('x', i * wcColWidth + wcColWidth / 2)
                            .attr('y', chartHeight + 16)
                            .attr('text-anchor', 'start')
                            .attr('font-size', '11px')
                            .attr('transform', `rotate(45, ${{i * wcColWidth + wcColWidth / 2}}, ${{chartHeight + 16}})`)
                            .text(stage.name);
                    }});

                    // Draw people bars (full width)
                    const barW = wcColWidth - 12;
                    filteredData.forEach((stage, i) => {{
                        const bh = stage.filteredCount * (wcBoxSize + wcBoxGap);
                        const x = i * wcColWidth + (wcColWidth - barW) / 2;
                        const y = chartHeight - bh;
                        chart.append('rect')
                            .attr('x', x).attr('y', y)
                            .attr('width', barW).attr('height', bh)
                            .attr('rx', 3)
                            .attr('fill', '#20c40a')
                            .attr('stroke', '#0f3460')
                            .attr('stroke-width', 1.5)
                            .style('cursor', 'pointer')
                            .on('mouseover', () => {{
                                const names = stage.filteredPeople.map(fp => fp.name).join(', ') || 'None';
                                tooltip.textContent = names;
                                tooltip.classList.add('visible');
                            }})
                            .on('mousemove', (event) => {{
                                tooltip.style.left = (event.clientX + 12) + 'px';
                                tooltip.style.top = (event.clientY - 10) + 'px';
                            }})
                            .on('mouseout', () => {{
                                tooltip.classList.remove('visible');
                            }});
                    }});

                    // Narrow overlay bars for Doc Coverage and Complexity (on top of people bars)
                    const narrowW = 8;
                    const overlays = [
                        {{ key: 'doc_coverage', fill: '#00d2ff', label: 'Doc Coverage Score' }},
                        {{ key: 'complexity', fill: '#ff6b6b', label: 'Complexity Score' }},
                    ];
                    const totalNarrowW = overlays.length * narrowW + (overlays.length - 1) * 2;

                    filteredData.forEach((stage, i) => {{
                        overlays.forEach((ov, oIdx) => {{
                            const val = stage[ov.key];
                            const bh = chartHeight - yRight(val);
                            const colCenter = i * wcColWidth + wcColWidth / 2;
                            const groupStart = colCenter - totalNarrowW / 2;
                            const x = groupStart + oIdx * (narrowW + 2);
                            const y = chartHeight - bh;
                            chart.append('rect')
                                .attr('x', x).attr('y', y)
                                .attr('width', narrowW).attr('height', bh)
                                .attr('rx', 2)
                                .attr('fill', ov.fill)
                                .attr('stroke', '#0f3460')
                                .attr('stroke-width', 1)
                                .style('cursor', 'pointer')
                                .on('mouseover', () => {{
                                    tooltip.textContent = ov.label + ': ' + val;
                                    tooltip.classList.add('visible');
                                }})
                                .on('mousemove', (event) => {{
                                    tooltip.style.left = (event.clientX + 12) + 'px';
                                    tooltip.style.top = (event.clientY - 10) + 'px';
                                }})
                                .on('mouseout', () => {{
                                    tooltip.classList.remove('visible');
                                }});
                        }});
                    }});

                    // Legend
                    const legendX = chartWidth + 30;
                    const legendItems = [
                        {{ color: '#20c40a', label: 'People', type: 'rect' }},
                        {{ color: '#00d2ff', label: 'Doc Coverage Score', type: 'rect' }},
                        {{ color: '#ff6b6b', label: 'Complexity Score', type: 'rect' }},
                    ];
                    legendItems.forEach((item, idx) => {{
                        const ly = idx * 20;
                        if (item.type === 'rect') {{
                            chart.append('rect')
                                .attr('x', legendX).attr('y', ly)
                                .attr('width', 12).attr('height', 12)
                                .attr('rx', 2)
                                .attr('fill', item.color);
                        }} else {{
                            chart.append('line')
                                .attr('x1', legendX).attr('y1', ly + 6)
                                .attr('x2', legendX + 12).attr('y2', ly + 6)
                                .attr('stroke', item.color)
                                .attr('stroke-width', 2.5)
                                .attr('stroke-dasharray', item.dashed ? '4,3' : 'none');
                            chart.append('circle')
                                .attr('cx', legendX + 6).attr('cy', ly + 6).attr('r', 3)
                                .attr('fill', item.color);
                        }}
                        chart.append('text')
                            .attr('class', 'legend-label')
                            .attr('x', legendX + 18).attr('y', ly + 10)
                            .text(item.label);
                    }});
                }});
            }});
        }}

        document.getElementById('generate-btn').addEventListener('click', generateRotation);

        // ===== People Tab =====
        let editingPeople = JSON.parse(JSON.stringify(allPeopleFull));

        // Build stage/process lookups from processes data
        const stageDisplayNames = {{}};
        const processStageMap = {{}};  // processName -> [{{id, name}}]
        const processNames = [];
        processes.forEach(proc => {{
            processNames.push(proc.name);
            processStageMap[proc.name] = [];
            proc.stages.forEach(stage => {{
                stageDisplayNames[stage.id] = stage.name;
                processStageMap[proc.name].push({{ id: stage.id, name: stage.name }});
            }});
        }});

        function renderPeopleCards() {{
            const container = document.getElementById('people-cards');
            container.innerHTML = '';
            editingPeople = JSON.parse(JSON.stringify(allPeopleFull));

            editingPeople.forEach((person, pIdx) => {{
                container.appendChild(buildPersonCard(person, pIdx));
            }});

            // Add Person card
            const addCard = document.createElement('div');
            addCard.className = 'add-person-card';
            addCard.textContent = '+ Add Person';
            addCard.addEventListener('click', () => {{
                editingPeople.push({{
                    name: 'New Person',
                    title: '',
                    flight_risk: 'low',
                    timezone: '',
                    processes: [],
                }});
                renderPeopleCards();
            }});
            container.appendChild(addCard);
        }}

        function buildPersonCard(person, pIdx) {{
            const card = document.createElement('div');
            card.className = 'person-card';

            let processesHtml = '';
            (person.processes || []).forEach((proc, prIdx) => {{
                let stagesHtml = '';
                const procStages = processStageMap[proc.name] || [];
                const existingIds = new Set((proc.stages || []).map(s => typeof s === 'string' ? s : s.id));

                (proc.stages || []).forEach((stage, stIdx) => {{
                    const sid = typeof stage === 'string' ? stage : stage.id;
                    const level = typeof stage === 'string' ? 'Contributor' : (stage.contributor_level || 'Contributor');
                    const displayName = stageDisplayNames[sid] || sid;
                    stagesHtml += `<div class="person-card-stage">
                        <span>${{displayName}}</span>
                        <div style="display:flex;align-items:center;gap:4px;">
                            <select class="card-field-select" data-person="${{pIdx}}" data-proc="${{prIdx}}" data-stage="${{stIdx}}" data-field="contributor_level">
                                <option value="Owner" ${{level === 'Owner' ? 'selected' : ''}}>Owner</option>
                                <option value="Contributor" ${{level === 'Contributor' ? 'selected' : ''}}>Contributor</option>
                                <option value="Learner" ${{level === 'Learner' ? 'selected' : ''}}>Learner</option>
                            </select>
                            <button class="card-delete-btn" data-action="delete-stage" data-person="${{pIdx}}" data-proc="${{prIdx}}" data-stage="${{stIdx}}" title="Remove stage">&times;</button>
                        </div>
                    </div>`;
                }});

                // Add Stage dropdown (only stages not already added)
                const availableStages = procStages.filter(s => !existingIds.has(s.id));
                let addStageHtml = '';
                if (availableStages.length > 0) {{
                    let opts = '<option value="">+ Add Stage...</option>';
                    availableStages.forEach(s => {{
                        opts += `<option value="${{s.id}}">${{s.name}}</option>`;
                    }});
                    addStageHtml = `<select class="card-field-select card-add-btn" data-action="add-stage" data-person="${{pIdx}}" data-proc="${{prIdx}}" style="margin-top:6px;">${{opts}}</select>`;
                }}

                processesHtml += `<div class="person-card-process">
                    <div style="display:flex;align-items:center;justify-content:space-between;">
                        <div class="person-card-process-name">${{proc.name}}</div>
                        <button class="card-delete-btn" data-action="delete-process" data-person="${{pIdx}}" data-proc="${{prIdx}}" title="Remove process">&times;</button>
                    </div>
                    ${{stagesHtml}}
                    ${{addStageHtml}}
                </div>`;
            }});

            // Add Process button (only processes not already on this person)
            const existingProcs = new Set((person.processes || []).map(p => p.name));
            const availableProcs = processNames.filter(n => !existingProcs.has(n));
            let addProcHtml = '';
            if (availableProcs.length > 0) {{
                let opts = '<option value="">+ Add Process...</option>';
                availableProcs.forEach(n => {{
                    opts += `<option value="${{n}}">${{n}}</option>`;
                }});
                addProcHtml = `<select class="card-field-select card-add-btn" data-action="add-process" data-person="${{pIdx}}">${{opts}}</select>`;
            }}

            card.innerHTML = `
                <div class="person-card-header">
                    <input class="card-field person-card-name" value="${{person.name}}" data-person="${{pIdx}}" data-field="name" style="font-size:18px;font-weight:700;border:none;background:transparent;color:#fff;padding:0;" onfocus="this.style.background='#1a1a2e';this.style.padding='4px 8px';this.style.border='1px solid #2a2a4a';this.style.borderRadius='4px'" onblur="this.style.background='transparent';this.style.padding='0';this.style.border='none'">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span class="card-saved-msg" id="saved-${{pIdx}}">Saved</span>
                        <button class="card-edit-btn" data-person="${{pIdx}}">Save</button>
                        <button class="card-delete-person" data-action="delete-person" data-person="${{pIdx}}">Delete</button>
                    </div>
                </div>
                <input class="card-field" value="${{person.title || ''}}" data-person="${{pIdx}}" data-field="title" placeholder="Title" style="margin-bottom:10px;">
                <div class="person-card-meta">
                    <select class="card-field-select" data-person="${{pIdx}}" data-field="flight_risk" style="width:auto;">
                        <option value="low" ${{person.flight_risk === 'low' ? 'selected' : ''}}>Low Risk</option>
                        <option value="medium" ${{person.flight_risk === 'medium' ? 'selected' : ''}}>Medium Risk</option>
                        <option value="high" ${{person.flight_risk === 'high' ? 'selected' : ''}}>High Risk</option>
                    </select>
                    <input class="card-field" value="${{person.timezone || ''}}" data-person="${{pIdx}}" data-field="timezone" placeholder="Timezone" style="width:auto;min-width:160px;">
                </div>
                ${{processesHtml}}
                ${{addProcHtml}}
            `;

            // Wire up events
            card.querySelectorAll('[data-field]').forEach(el => {{
                el.addEventListener('change', handleFieldChange);
                el.addEventListener('input', handleFieldChange);
            }});

            card.querySelector('.card-edit-btn').addEventListener('click', () => savePeople(pIdx));

            card.querySelector('.card-delete-person').addEventListener('click', () => {{
                if (confirm(`Delete ${{person.name}}?`)) {{
                    editingPeople.splice(pIdx, 1);
                    renderPeopleCards();
                }}
            }});

            card.querySelectorAll('[data-action="delete-stage"]').forEach(btn => {{
                btn.addEventListener('click', () => {{
                    const pi = parseInt(btn.dataset.person);
                    const pri = parseInt(btn.dataset.proc);
                    const sti = parseInt(btn.dataset.stage);
                    editingPeople[pi].processes[pri].stages.splice(sti, 1);
                    renderPeopleCards();
                }});
            }});

            card.querySelectorAll('[data-action="delete-process"]').forEach(btn => {{
                btn.addEventListener('click', () => {{
                    const pi = parseInt(btn.dataset.person);
                    const pri = parseInt(btn.dataset.proc);
                    editingPeople[pi].processes.splice(pri, 1);
                    renderPeopleCards();
                }});
            }});

            card.querySelectorAll('[data-action="add-stage"]').forEach(sel => {{
                sel.addEventListener('change', () => {{
                    if (!sel.value) return;
                    const pi = parseInt(sel.dataset.person);
                    const pri = parseInt(sel.dataset.proc);
                    editingPeople[pi].processes[pri].stages.push({{ id: sel.value, contributor_level: 'Contributor' }});
                    renderPeopleCards();
                }});
            }});

            card.querySelectorAll('[data-action="add-process"]').forEach(sel => {{
                sel.addEventListener('change', () => {{
                    if (!sel.value) return;
                    const pi = parseInt(sel.dataset.person);
                    if (!editingPeople[pi].processes) editingPeople[pi].processes = [];
                    editingPeople[pi].processes.push({{ name: sel.value, stages: [] }});
                    renderPeopleCards();
                }});
            }});

            return card;
        }}

        function handleFieldChange(e) {{
            const el = e.target;
            const pIdx = parseInt(el.dataset.person);
            const field = el.dataset.field;

            if (el.dataset.proc !== undefined) {{
                const prIdx = parseInt(el.dataset.proc);
                const stIdx = parseInt(el.dataset.stage);
                const stage = editingPeople[pIdx].processes[prIdx].stages[stIdx];
                if (typeof stage === 'string') {{
                    editingPeople[pIdx].processes[prIdx].stages[stIdx] = {{ id: stage, [field]: el.value }};
                }} else {{
                    stage[field] = el.value;
                }}
            }} else {{
                editingPeople[pIdx][field] = el.value;
            }}
        }}

        async function savePeople(pIdx) {{
            const btn = document.querySelector(`.card-edit-btn[data-person="${{pIdx}}"]`);
            const msg = document.getElementById(`saved-${{pIdx}}`);
            btn.textContent = 'Saving...';
            btn.classList.add('saving');
            try {{
                const resp = await fetch('/api/people', {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify(editingPeople),
                }});
                if (!resp.ok) throw new Error('Save failed');
                allPeopleFull.length = 0;
                editingPeople.forEach(p => allPeopleFull.push(JSON.parse(JSON.stringify(p))));
                btn.textContent = 'Save';
                btn.classList.remove('saving');
                msg.classList.add('show');
                setTimeout(() => msg.classList.remove('show'), 2000);
            }} catch (err) {{
                btn.textContent = 'Error!';
                btn.classList.remove('saving');
                setTimeout(() => {{ btn.textContent = 'Save'; }}, 2000);
            }}
        }}

        // ===== Processes Tab =====
        let editingProcesses = JSON.parse(JSON.stringify(allRawProcesses));

        function renderProcessCards() {{
            const container = document.getElementById('process-cards');
            container.innerHTML = '';
            editingProcesses = JSON.parse(JSON.stringify(allRawProcesses));

            editingProcesses.forEach((proc, procIdx) => {{
                container.appendChild(buildProcessCard(proc, procIdx));
            }});

            // Add Process card
            const addCard = document.createElement('div');
            addCard.className = 'add-person-card';
            addCard.textContent = '+ Add Process';
            addCard.addEventListener('click', () => {{
                editingProcesses.push({{
                    name: 'New Process',
                    stages: [],
                }});
                renderProcessCards();
            }});
            container.appendChild(addCard);
        }}

        function buildProcessCard(proc, procIdx) {{
            const card = document.createElement('div');
            card.className = 'person-card';

            let stagesHtml = '';
            (proc.stages || []).forEach((stage, stIdx) => {{
                const onCallChecked = stage.on_call ? 'checked' : '';
                const stageCount = (proc.stages || []).length;
                stagesHtml += `<div class="stage-detail-row">
                    <div class="stage-detail-header">
                        <div style="display:flex;align-items:center;">
                            <div class="stage-order-btns">
                                <button class="stage-order-btn" data-action="move-stage-up" data-proc="${{procIdx}}" data-stage="${{stIdx}}" ${{stIdx === 0 ? 'disabled' : ''}} title="Move up">&#9650;</button>
                                <button class="stage-order-btn" data-action="move-stage-down" data-proc="${{procIdx}}" data-stage="${{stIdx}}" ${{stIdx === stageCount - 1 ? 'disabled' : ''}} title="Move down">&#9660;</button>
                            </div>
                            <input class="card-field" value="${{stage.display_name || stage.id || ''}}" data-proc="${{procIdx}}" data-stage="${{stIdx}}" data-sfield="display_name" style="font-size:14px;font-weight:600;color:#fff;">
                        </div>
                        <button class="card-delete-btn" data-action="delete-proc-stage" data-proc="${{procIdx}}" data-stage="${{stIdx}}" title="Remove stage">&times;</button>
                    </div>
                    <div class="stage-detail-fields">
                        <div class="field-group">
                            <label>ID</label>
                            <input class="card-field" value="${{stage.id || ''}}" data-proc="${{procIdx}}" data-stage="${{stIdx}}" data-sfield="id">
                        </div>
                        <div class="field-group">
                            <label>Complexity (1-5)</label>
                            <select class="card-field-select" data-proc="${{procIdx}}" data-stage="${{stIdx}}" data-sfield="complexity">
                                ${{[1,2,3,4,5].map(n => `<option value="${{n}}" ${{(stage.complexity||3)===n?'selected':''}}>${{n}}</option>`).join('')}}
                            </select>
                        </div>
                        <div class="field-group">
                            <label>Doc Coverage (1-5)</label>
                            <select class="card-field-select" data-proc="${{procIdx}}" data-stage="${{stIdx}}" data-sfield="documentation_coverage">
                                ${{[1,2,3,4,5].map(n => `<option value="${{n}}" ${{(stage.documentation_coverage||3)===n?'selected':''}}>${{n}}</option>`).join('')}}
                            </select>
                        </div>
                        <div class="field-group">
                            <label>On-Call</label>
                            <select class="card-field-select" data-proc="${{procIdx}}" data-stage="${{stIdx}}" data-sfield="on_call">
                                <option value="true" ${{stage.on_call ? 'selected' : ''}}>Yes</option>
                                <option value="false" ${{!stage.on_call ? 'selected' : ''}}>No</option>
                            </select>
                        </div>
                    </div>
                    <textarea class="stage-comment-field" data-proc="${{procIdx}}" data-stage="${{stIdx}}" data-sfield="comment" placeholder="Stage description...">${{stage.comment || ''}}</textarea>
                </div>`;
            }});

            card.innerHTML = `
                <div class="person-card-header">
                    <input class="card-field person-card-name" value="${{proc.name}}" data-proc="${{procIdx}}" data-pfield="name" style="font-size:18px;font-weight:700;border:none;background:transparent;color:#fff;padding:0;" onfocus="this.style.background='#1a1a2e';this.style.padding='4px 8px';this.style.border='1px solid #2a2a4a';this.style.borderRadius='4px'" onblur="this.style.background='transparent';this.style.padding='0';this.style.border='none'">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span class="card-saved-msg" id="proc-saved-${{procIdx}}">Saved</span>
                        <button class="card-edit-btn" data-action="save-proc" data-proc="${{procIdx}}">Save</button>
                        <button class="card-delete-person" data-action="delete-proc" data-proc="${{procIdx}}">Delete</button>
                    </div>
                </div>
                <div style="font-size:12px;color:#888;margin-bottom:14px;">${{(proc.stages||[]).length}} stages</div>
                ${{stagesHtml}}
                <button class="card-add-btn" data-action="add-proc-stage" data-proc="${{procIdx}}" style="width:100%;">+ Add Stage</button>
            `;

            // Wire up process name field
            card.querySelectorAll('[data-pfield]').forEach(el => {{
                el.addEventListener('input', () => {{
                    editingProcesses[parseInt(el.dataset.proc)][el.dataset.pfield] = el.value;
                }});
            }});

            // Wire up stage fields
            card.querySelectorAll('[data-sfield]').forEach(el => {{
                const handler = () => {{
                    const pi = parseInt(el.dataset.proc);
                    const si = parseInt(el.dataset.stage);
                    const field = el.dataset.sfield;
                    let val = el.value;
                    if (field === 'complexity' || field === 'documentation_coverage') val = parseInt(val);
                    if (field === 'on_call') val = val === 'true';
                    editingProcesses[pi].stages[si][field] = val;
                }};
                el.addEventListener('change', handler);
                el.addEventListener('input', handler);
            }});

            // Save
            card.querySelector('[data-action="save-proc"]').addEventListener('click', () => saveProcesses(procIdx));

            // Delete process
            card.querySelector('[data-action="delete-proc"]').addEventListener('click', () => {{
                if (confirm(`Delete process "${{proc.name}}"?`)) {{
                    editingProcesses.splice(procIdx, 1);
                    renderProcessCards();
                }}
            }});

            // Delete stage
            card.querySelectorAll('[data-action="delete-proc-stage"]').forEach(btn => {{
                btn.addEventListener('click', () => {{
                    const pi = parseInt(btn.dataset.proc);
                    const si = parseInt(btn.dataset.stage);
                    editingProcesses[pi].stages.splice(si, 1);
                    renderProcessCards();
                }});
            }});

            // Move stage up/down
            card.querySelectorAll('[data-action="move-stage-up"]').forEach(btn => {{
                btn.addEventListener('click', () => {{
                    const pi = parseInt(btn.dataset.proc);
                    const si = parseInt(btn.dataset.stage);
                    if (si > 0) {{
                        const stages = editingProcesses[pi].stages;
                        [stages[si - 1], stages[si]] = [stages[si], stages[si - 1]];
                        renderProcessCards();
                    }}
                }});
            }});
            card.querySelectorAll('[data-action="move-stage-down"]').forEach(btn => {{
                btn.addEventListener('click', () => {{
                    const pi = parseInt(btn.dataset.proc);
                    const si = parseInt(btn.dataset.stage);
                    const stages = editingProcesses[pi].stages;
                    if (si < stages.length - 1) {{
                        [stages[si], stages[si + 1]] = [stages[si + 1], stages[si]];
                        renderProcessCards();
                    }}
                }});
            }});

            // Add stage
            card.querySelector('[data-action="add-proc-stage"]').addEventListener('click', () => {{
                editingProcesses[procIdx].stages.push({{
                    id: 'new_stage',
                    display_name: 'New Stage',
                    complexity: 3,
                    documentation_coverage: 3,
                    on_call: false,
                    comment: '',
                }});
                renderProcessCards();
            }});

            return card;
        }}

        async function saveProcesses(procIdx) {{
            const btn = document.querySelector(`[data-action="save-proc"][data-proc="${{procIdx}}"]`);
            const msg = document.getElementById(`proc-saved-${{procIdx}}`);
            btn.textContent = 'Saving...';
            btn.classList.add('saving');
            try {{
                const resp = await fetch('/api/processes', {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify(editingProcesses),
                }});
                if (!resp.ok) throw new Error('Save failed');
                allRawProcesses.length = 0;
                editingProcesses.forEach(p => allRawProcesses.push(JSON.parse(JSON.stringify(p))));
                btn.textContent = 'Save';
                btn.classList.remove('saving');
                msg.classList.add('show');
                setTimeout(() => msg.classList.remove('show'), 2000);
            }} catch (err) {{
                btn.textContent = 'Error!';
                btn.classList.remove('saving');
                setTimeout(() => {{ btn.textContent = 'Save'; }}, 2000);
            }}
        }}
    </script>
</body>
</html>"""
