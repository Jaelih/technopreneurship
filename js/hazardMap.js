/* ═══════════════════════════════════════════════════════
   hazardMap.js — Leaflet Philippine Hazard Map
   ═══════════════════════════════════════════════════════ */

var HazardMap = (function () {

  var map = null;
  var layers = {};
  var initialized = false;

  // ─── Data: Philippine Hazard Zones ───────────────────

  var floodZones = [
    // Manila Bay area
    { center: [14.5995, 120.9842], radius: 5000, risk: 'high',   label: 'Manila Bay Flood Zone' },
    { center: [14.8527, 120.8167], radius: 6000, risk: 'high',   label: 'Bulacan Flood Plain' },
    { center: [14.7090, 121.0450], radius: 3000, risk: 'medium', label: 'Marikina River Basin' },
    // Leyte
    { center: [11.2499, 124.9419], radius: 8000, risk: 'high',   label: 'Leyte Gulf Storm Surge' },
    { center: [11.0000, 124.6000], radius: 5000, risk: 'high',   label: 'Southern Leyte Flood' },
    // Cebu
    { center: [10.3157, 123.8854], radius: 3000, risk: 'medium', label: 'Cebu Coastal Flood' },
    // Pampanga
    { center: [15.0794, 120.6200], radius: 7000, risk: 'high',   label: 'Pampanga River Flood' },
    { center: [14.9200, 120.7200], radius: 4000, risk: 'medium', label: 'Angeles Low-Lying Zone' },
    // Mindanao
    { center: [7.0700,  125.6100], radius: 3000, risk: 'medium', label: 'Davao River Flood Zone' },
    { center: [8.1500,  124.2500], radius: 4000, risk: 'high',   label: 'Cagayan de Oro Flashflood' },
    // Batangas
    { center: [13.7565, 121.0583], radius: 3500, risk: 'medium', label: 'Batangas Bay Surge Zone' },
    // Iloilo
    { center: [10.7202, 122.5621], radius: 3000, risk: 'medium', label: 'Iloilo River Plain' }
  ];

  var landslideZones = [
    { center: [16.4023, 120.5960], radius: 6000, risk: 'high',   label: 'Benguet Landslide Risk' },
    { center: [16.6159, 121.7250], radius: 5000, risk: 'high',   label: 'Aurora Mountain Slopes' },
    { center: [11.0500, 124.4500], radius: 4000, risk: 'high',   label: 'Southern Leyte Landslide' },
    { center: [7.8312,  125.2265], radius: 3500, risk: 'medium', label: 'Compostela Valley Risk' },
    { center: [9.0500,  125.5900], radius: 3000, risk: 'medium', label: 'Surigao del Sur Slopes' },
    { center: [13.1339, 123.7340], radius: 4000, risk: 'high',   label: 'Albay Mayon Flanks' },
    { center: [15.4800, 120.5900], radius: 3000, risk: 'medium', label: 'Zambales Mountains' }
  ];

  var shelters = [
    { pos: [14.5995, 120.9842], name: 'Manila Sports Complex Evacuation Center', capacity: 5000 },
    { pos: [14.6760, 121.0437], name: 'Quezon City DRRM Evacuation Hub', capacity: 3000 },
    { pos: [14.4426, 121.0470], name: 'Muntinlupa Community Hall', capacity: 1500 },
    { pos: [11.2499, 124.9419], name: 'Tacloban Eastern Visayas Emergency Center', capacity: 4000 },
    { pos: [10.3157, 123.8854], name: 'Cebu City Convention Center Shelter', capacity: 6000 },
    { pos: [7.0909,  125.6087], name: 'Davao Sports Stadium Shelter', capacity: 8000 },
    { pos: [15.0794, 120.6200], name: 'San Fernando Pampanga Evacuation Center', capacity: 2000 },
    { pos: [13.7565, 121.0583], name: 'Batangas City Sports Complex', capacity: 2500 },
    { pos: [16.4023, 120.5960], name: 'Baguio City Convention Center', capacity: 3000 },
    { pos: [10.7202, 122.5621], name: 'Iloilo City Evacuation Hub', capacity: 2000 },
    { pos: [8.1500,  124.2500], name: 'Cagayan de Oro City Hall Shelter', capacity: 3000 }
  ];

  var evacRoutes = [
    { path: [[14.5995, 120.9842], [14.6760, 121.0437], [14.7750, 121.0500]], label: 'NCR Northern Evac Route' },
    { path: [[14.5995, 120.9842], [14.4426, 121.0470], [14.3500, 121.1000]], label: 'NCR Southern Evac Route' },
    { path: [[11.2499, 124.9419], [11.1000, 124.9000], [10.9000, 124.8000]], label: 'Leyte Southern Escape Route' },
    { path: [[10.3157, 123.8854], [10.4000, 123.9500], [10.5000, 124.0000]], label: 'Cebu Northern Evac Route' },
    { path: [[15.0794, 120.6200], [15.2000, 120.5800], [15.4800, 120.5900]], label: 'Pampanga Highland Route' },
    { path: [[8.1500, 124.2500], [8.3000, 124.4000], [8.5000, 124.6000]], label: 'Cagayan de Oro Highland Route' }
  ];

  var stormPaths = [
    {
      path: [[7.0, 130.0], [9.0, 128.0], [11.0, 126.0], [13.0, 124.0], [15.0, 122.0], [17.0, 121.0]],
      label: 'Typhoon Haiyan-type Path (Nov)', intensity: 'Super Typhoon'
    },
    {
      path: [[10.0, 132.0], [12.0, 129.0], [14.0, 126.0], [16.0, 123.0], [18.0, 121.0]],
      label: 'Central Philippines Track', intensity: 'Typhoon'
    },
    {
      path: [[13.0, 133.0], [14.0, 130.0], [15.0, 127.0], [16.0, 124.0], [17.0, 121.0]],
      label: 'Northern Track Path', intensity: 'Severe Tropical Storm'
    }
  ];

  // ─── Color helpers ────────────────────────────────────

  var riskColors = { high: '#e74c3c', medium: '#e67e22', low: '#f1c40f' };

  // ─── Init ─────────────────────────────────────────────
  function init() {
    if (initialized) {
      map.invalidateSize();
      return;
    }
    initialized = true;

    map = L.map('map-container', {
      center: [12.8797, 121.7740], // Philippines center
      zoom: 6,
      zoomControl: true,
      preferCanvas: true
    });

    // Tile layer (OpenStreetMap)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 18
    }).addTo(map);

    // Build layer groups
    layers.flood    = buildFloodLayer();
    layers.landslide = buildLandslideLayer();
    layers.evac     = buildEvacLayer();
    layers.shelters = buildSheltersLayer();
    layers.storms   = buildStormLayer();

    // Add all except storms by default
    layers.flood.addTo(map);
    layers.landslide.addTo(map);
    layers.evac.addTo(map);
    layers.shelters.addTo(map);

    // Update stats
    document.getElementById('stat-flood-count').textContent = floodZones.length;
    document.getElementById('stat-shelter-count').textContent = shelters.length;
    document.getElementById('stat-evac-count').textContent = evacRoutes.length;

    // Fit Philippines bounds
    map.fitBounds([[4.5, 116.0], [21.0, 127.0]]);
  }

  // ─── Layer Builders ───────────────────────────────────

  function buildFloodLayer() {
    var group = L.layerGroup();
    floodZones.forEach(function (z) {
      L.circle(z.center, {
        radius: z.radius,
        color: riskColors[z.risk],
        fillColor: riskColors[z.risk],
        fillOpacity: 0.25,
        weight: 1.5,
        dashArray: z.risk === 'high' ? null : '4'
      }).bindPopup(
        '<div style="font-family:sans-serif">' +
        '<strong>' + z.label + '</strong><br>' +
        '<span style="color:' + riskColors[z.risk] + '">● ' + capitalize(z.risk) + ' Risk</span><br>' +
        '<small>Flood Zone — Radius: ' + (z.radius / 1000).toFixed(1) + ' km</small>' +
        '</div>'
      ).addTo(group);
    });
    return group;
  }

  function buildLandslideLayer() {
    var group = L.layerGroup();
    landslideZones.forEach(function (z) {
      var color = riskColors[z.risk];
      L.circle(z.center, {
        radius: z.radius,
        color: color,
        fillColor: color,
        fillOpacity: 0.2,
        weight: 2,
        dashArray: '6 4'
      }).bindPopup(
        '<div style="font-family:sans-serif">' +
        '<strong>' + z.label + '</strong><br>' +
        '<span style="color:' + color + '">⛰ ' + capitalize(z.risk) + ' Landslide Risk</span><br>' +
        '<small>Avoid during heavy rain events</small>' +
        '</div>'
      ).addTo(group);
    });
    return group;
  }

  function buildEvacLayer() {
    var group = L.layerGroup();
    evacRoutes.forEach(function (r) {
      L.polyline(r.path, {
        color: '#27ae60',
        weight: 4,
        opacity: 0.85,
        dashArray: null
      }).bindPopup(
        '<div style="font-family:sans-serif">' +
        '<strong>🚗 ' + r.label + '</strong><br>' +
        '<span style="color:#27ae60">Designated Evacuation Route</span>' +
        '</div>'
      ).addTo(group);

      // Arrow markers along the route
      if (r.path.length >= 2) {
        var mid = r.path[Math.floor(r.path.length / 2)];
        L.marker(mid, {
          icon: L.divIcon({
            html: '<div style="background:#27ae60;color:#fff;padding:3px 8px;border-radius:10px;font-size:11px;font-weight:bold;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.4)">➡ ' + r.label + '</div>',
            className: '',
            iconAnchor: [60, 12]
          })
        }).addTo(group);
      }
    });
    return group;
  }

  function buildSheltersLayer() {
    var group = L.layerGroup();
    var shelterIcon = L.divIcon({
      html: '<div style="background:#2980b9;color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.5)">🏛</div>',
      className: '',
      iconAnchor: [14, 14]
    });

    shelters.forEach(function (s) {
      L.marker(s.pos, { icon: shelterIcon })
        .bindPopup(
          '<div style="font-family:sans-serif;min-width:200px">' +
          '<strong>🏛 ' + s.name + '</strong><br>' +
          '<span style="color:#2980b9">✅ Designated Safe Shelter</span><br>' +
          '<small>Capacity: <strong>' + s.capacity.toLocaleString() + '</strong> persons</small>' +
          '</div>'
        )
        .addTo(group);
    });
    return group;
  }

  function buildStormLayer() {
    var group = L.layerGroup();
    var intensityColors = {
      'Super Typhoon': '#e74c3c',
      'Typhoon': '#e67e22',
      'Severe Tropical Storm': '#f1c40f'
    };

    stormPaths.forEach(function (s) {
      var color = intensityColors[s.intensity] || '#e74c3c';
      L.polyline(s.path, {
        color: color,
        weight: 3,
        opacity: 0.8,
        dashArray: '8 5'
      }).bindPopup(
        '<div style="font-family:sans-serif">' +
        '<strong>🌪️ ' + s.label + '</strong><br>' +
        '<span style="color:' + color + '">Category: ' + s.intensity + '</span>' +
        '</div>'
      ).addTo(group);

      // Storm icon at first point
      L.marker(s.path[0], {
        icon: L.divIcon({
          html: '<div style="font-size:24px">🌀</div>',
          className: '',
          iconAnchor: [12, 12]
        })
      }).bindPopup('<strong>' + s.intensity + '</strong><br>' + s.label).addTo(group);
    });
    return group;
  }

  // ─── Controls ─────────────────────────────────────────

  function toggleLayer(name, visible) {
    if (!layers[name]) return;
    if (visible) {
      layers[name].addTo(map);
    } else {
      map.removeLayer(layers[name]);
    }
  }

  var locations = {
    manila:   { center: [14.5995, 120.9842], zoom: 11 },
    leyte:    { center: [11.2499, 124.9419], zoom: 10 },
    cebu:     { center: [10.3157, 123.8854], zoom: 11 },
    davao:    { center: [7.0909, 125.6087],  zoom: 11 },
    pampanga: { center: [15.0794, 120.6200], zoom: 11 },
    batangas: { center: [13.7565, 121.0583], zoom: 11 }
  };

  function jumpTo(key) {
    if (!key || !locations[key]) return;
    var loc = locations[key];
    map.flyTo(loc.center, loc.zoom, { duration: 1.5 });
  }

  // ─── Helpers ──────────────────────────────────────────
  function capitalize(str) { return str.charAt(0).toUpperCase() + str.slice(1); }

  // ─── Public API ───────────────────────────────────────
  return {
    init: init,
    toggleLayer: toggleLayer,
    jumpTo: jumpTo
  };

})();
