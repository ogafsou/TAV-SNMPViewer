function renderMonitor(data, record) {
  updateAdvancedInformationVisibility(data.type, true);
  document.getElementById("lastScan").textContent = formatDate(data.timestamp);
  var primarySlots = data.inputSlots || data.outputSlots;
  document.getElementById("slotCount").textContent = primarySlots.error
    ? "Erreur: " + primarySlots.error
    : plural(primarySlots.count, "slot");
  document.getElementById("screenCount").textContent = data.screens.error
    ? "Erreur: " + data.screens.error
    : plural(data.screens.count, "ecran");
  var outputPorts = Array.isArray(data.outputPorts) ? data.outputPorts : [];
  var receivingCards = Array.isArray(data.receivingCards) ? data.receivingCards : [];
  document.getElementById("portCount").textContent = plural(outputPorts.length, "port");
  document.getElementById("cardCount").textContent = plural(receivingCards.length, "card");

  renderSummary(data, record);
  renderController(data.controller, data.type);
  renderSystemHealth(data.controller);
  renderMvr(data.mvrCards || [], data.mvrVideo || {});
  renderSimpleStatusSection("usbSection", "usbTable", data.usbPorts || [], "usbId", "USB ");
  renderSimpleStatusSection("fansSection", "fansTable", data.fans || [], "fanId", "Ventilateur ");
  renderSimpleStatusSection("powerSection", "powerTable", data.powerSupplies || [], "powerId", "Alimentation ");
  renderSlots(primarySlots.slots);
  renderScreens(data.screens.screens);
  renderOutputPorts(outputPorts);
  renderCards(receivingCards);
}


function renderSummary(data, record) {
  var controller = data.controller;
  var lastScanAt = (record && record.lastSuccessfulAt) || data.timestamp;
  if (data.type === "other") {
    renderPingSummary(data, record);
    return;
  }
  if (data.type === "kiloview") {
    document.getElementById("summaryGrid").innerHTML = [
      summaryTile("Equipement", data.host),
      summaryTile("Type", "Kiloview"),
      summaryTile("Mode", fieldValue(controller.kiloviewMode) || "-"),
      summaryTile("Statut", fieldValue(controller.workingStatus) || "-"),
      summaryTile("CPU", fieldValue(controller.cpuLoad) || "-"),
      summaryTile("Memoire", fieldValue(controller.memoryUsed) || "-"),
      summaryTile("Reseau", fieldValue(controller.networkState) || "-"),
      summaryTile("Source", "KILOVIEW API"),
      summaryTile("Last Scan", lastScanAt ? formatDate(lastScanAt) : "-", "timestamp-metric")
    ].join("");
    return;
  }
  if (data.type === "netgear-m4300") {
    var ports = data.netgearPorts || [];
    document.getElementById("summaryGrid").innerHTML = [
      summaryTile("Equipement", data.host),
      summaryTile("Type", "NETGEAR M4300"),
      summaryTile("Nom", fieldValue(controller.systemName) || "-"),
      summaryTile("Modele", fieldValue(controller.model) || "-"),
      summaryTile("Statut", fieldValue(controller.workingStatus) || "-"),
      summaryTile("Uptime", fieldValue(controller.workingTime) || "-"),
      summaryTile("Ports", ports.length),
      summaryTile("Source", "SNMP V2C"),
      summaryTile("Last Scan", lastScanAt ? formatDate(lastScanAt) : "-", "timestamp-metric")
    ].join("");
    return;
  }
  var model = data.configuredModel || fieldValue(controller.model);
  var firmware = fieldValue(controller.firmware);
  var status = fieldValue(controller.workingStatus);
  var temp = fieldValue(controller.temperatureStatus);

  document.getElementById("summaryGrid").innerHTML = [
    summaryTile("Equipement", data.host),
    summaryTile("Modele", model || "-"),
    summaryTile("Firmware", firmware || "-"),
    summaryTile("Statut", status || "-"),
    summaryTile("Temperature", temp || "-"),
    summaryTile("Source", (data.source || "snmp").toUpperCase()),
    summaryTile("Slots entree", (data.inputSlots && data.inputSlots.count) || 0),
    summaryTile("Slots sortie", (data.outputSlots && data.outputSlots.count) || 0),
    summaryTile("Last Scan", lastScanAt ? formatDate(lastScanAt) : "-", "timestamp-metric")
  ].join("");
}

function renderPingSummary(data, record) {
  var connected = record && record.view ? record.view.connected === true
    : data.controller && data.controller.workingStatus && data.controller.workingStatus.ok === true;
  var lastSuccessfulAt = record && record.lastSuccessfulAt;
  document.getElementById("summaryGrid").innerHTML = [
    summaryTile("IP adresse", data.host || "-"),
    summaryTile("Statut", connected ? "Online" : "Offline"),
    summaryTile("Source", "PING"),
    summaryTile("Last Ping", lastSuccessfulAt ? formatDate(lastSuccessfulAt) : "-", "timestamp-metric")
  ].join("");
}

function renderController(controller, type) {
  var novaStarLabels = {
    oidVersion: "OID version",
    summary: "Resume",
    workingTime: "Temps de marche",
    model: "Modele",
    firmware: "Firmware",
    serial: "Numero de serie",
    macAddress: "MAC",
    wiredIpAddress: "IP filaire",
    armVersion: "ARM",
    genlockStatus: "Genlock",
    genlockFrame: "Frame genlock",
    workingStatus: "Statut",
    cpuStatus: "CPU",
    memoryStatus: "Memoire",
    ethernetStatus: "Ethernet"
  };
  var kiloviewLabels = {
    workingStatus: "Statut",
    kiloviewMode: "Mode",
    deviceAddress: "Adresse du peripherique",
    workingTime: "Temps de fonctionnement",
    startTime: "Date de demarrage",
    cpuLoad: "Charge CPU",
    memoryUsed: "Memoire utilisee",
    memoryTotal: "Memoire totale",
    networkInterfaces: "Interfaces reseau",
    networkState: "Etat du reseau",
    ndiDeviceName: "Nom du peripherique NDI",
    ndiChannelName: "Nom du canal NDI",
    ndiGroup: "Groupe NDI",
    ndiConnection: "Connexion NDI",
    encodingQuality: "Qualite d'encodage",
    videoSignal: "Presence du signal video",
    videoInputType: "Type d'entree video",
    videoResolution: "Resolution video",
    instantFrameRate: "Frequence video reelle",
    interlaced: "Video entrelacee",
    deinterlaced: "Desentrelacement actif",
    videoBitrate: "Debit video",
    audioPresence: "Presence du signal audio",
    audioSource: "Source audio",
    audioFormat: "Format audio",
    audioSampling: "Echantillonnage audio",
    audioChannels: "Canaux audio",
    audioVolume: "Volume audio",
    ndiSourceName: "Source NDI decodee",
    ndiSourceUrl: "URL de la source NDI",
    ndiSourceIp: "IP de la source NDI",
    ndiSourceOnline: "Source NDI en ligne",
    ndiSourceActive: "Source NDI active",
    outputResolution: "Resolution de sortie",
    outputFrameRate: "Frequence de sortie",
    decoderWarning: "Avertissement decodeur",
    warningOffline: "Source hors ligne",
    warningUrlChanged: "URL modifiee",
    errorNoVideo: "Absence de sortie video",
    errorNoAudio: "Absence de sortie audio",
    warningInvalid: "Configuration invalide",
    warningMatch: "Erreur de format",
    warningUnsupportedCodec: "Codec non pris en charge",
    warningUnsupportedResolution: "Resolution non prise en charge"
  };
  var netgearLabels = {
    workingStatus: "Statut",
    systemName: "Nom systeme",
    model: "Description / modele",
    sysObjectId: "sysObjectID",
    workingTime: "Temps de marche",
    location: "Emplacement"
  };
  var labels = type === "kiloview" ? kiloviewLabels : type === "netgear-m4300" ? netgearLabels : novaStarLabels;

  document.getElementById("controllerGrid").innerHTML = Object.keys(labels).filter(function(key) {
    return (type !== "kiloview" && type !== "netgear-m4300") || controller[key] !== undefined;
  }).map(function(key) {
    return fieldTile(labels[key], controller[key]);
  }).join("");
}

function renderSlots(slots) {
  var body = document.getElementById("slotsTable");

  if (!slots.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty">Aucun slot retourne.</td></tr>';
    return;
  }

  body.innerHTML = slots.map(function(slot) {
    var sourceDetails = slot.inputSources && slot.inputSources.length
      ? formatInputSources(slot.inputSources)
      : formatInputSource(slot.fields);

    return "<tr>" +
      cell(slot.slotId) +
      cell(fieldValue(slot.fields.status)) +
      cell(fieldValue(slot.fields.firmware)) +
      cell(fieldValue(slot.fields.serial)) +
      cell(fieldValue(slot.fields.sourceCount)) +
      cell(sourceDetails, "wide") +
    "</tr>";
  }).join("");
}

function formatInputSources(sources) {
  return sources.map(function(source) {
    var fields = source.fields;
    var width = fieldValue(fields.width);
    var height = fieldValue(fields.height);
    var frameRate = fieldValue(fields.frameRate);
    var type = fieldValue(fields.type);
    var status = fieldValue(fields.status);
    var parts = ["S" + source.sourceId];

    if (status) {
      parts.push("status " + status);
    }

    if (width && height) {
      parts.push(width + " x " + height);
    }

    if (frameRate) {
      parts.push(frameRate + " Hz");
    }

    if (type) {
      parts.push("type " + type);
    }

    return parts.join(": ");
  }).join("\n");
}

function formatInputSource(fields) {
  var width = fieldValue(fields.sourceWidth);
  var height = fieldValue(fields.sourceHeight);
  var frameRate = fieldValue(fields.sourceFrameRate);
  var type = fieldValue(fields.sourceType);
  var parts = [];

  if (width && height) {
    parts.push(width + " x " + height);
  }

  if (frameRate) {
    parts.push(frameRate + " Hz");
  }

  if (type) {
    parts.push("type " + type);
  }

  return parts.join(" / ") || fieldValue(fields.summary) || "-";
}

function renderScreens(screens) {
  var body = document.getElementById("screensTable");

  if (!screens.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty">Aucun ecran retourne.</td></tr>';
    return;
  }

  body.innerHTML = screens.map(function(screen) {
    var width = fieldValue(screen.fields.width);
    var height = fieldValue(screen.fields.height);

    return "<tr>" +
      cell(screen.screenId) +
      cell(fieldValue(screen.fields.name)) +
      cell(width && height ? width + " x " + height : "-") +
      cell(fieldValue(screen.fields.frameRate)) +
      cell(fieldValue(screen.fields.brightness)) +
      cell(fieldValue(screen.fields.displayMode)) +
    "</tr>";
  }).join("");
}

function renderSystemHealth(controller) {
  var fields = [
    ["Temperature", controller.temperatureStatus],
    ["Tension", controller.voltageStatus],
    ["Ethernet", controller.ethernetStatus],
    ["CPU", controller.cpuStatus],
    ["Memoire", controller.memoryStatus],
    ["Memoire disponible", controller.memoryValue]
  ].filter(function(item) { return item[1] && fieldValue(item[1]) !== ""; });
  var section = document.getElementById("systemHealthSection");
  section.hidden = !fields.length;
  document.getElementById("systemHealthGrid").innerHTML = fields.map(function(item) {
    return fieldTile(item[0], item[1]);
  }).join("");
}

function renderMvr(cards, video) {
  var section = document.getElementById("mvrSection");
  section.hidden = !cards.length;
  document.getElementById("mvrCount").textContent = plural(cards.length, "carte");
  document.getElementById("mvrTable").innerHTML = cards.length ? cards.map(function(card) {
    var interfaces = card.interfaces.map(function(intf) {
      return "#" + intf.interfaceId + " " + fieldValue(intf.fields.type) + " : " + fieldValue(intf.fields.signal);
    }).join(" | ");
    return "<tr>" +
      cell(card.slotId) +
      cell(fieldValue(card.fields.model)) +
      cell(fieldValue(card.fields.serial)) +
      cell(fieldValue(card.fields.status)) +
      cell(fieldValue(card.fields.resolution)) +
      cell(interfaces || "-") +
    "</tr>";
  }).join("") : '<tr><td colspan="6" class="empty">Aucune carte MVR retournee.</td></tr>';

  var videoFields = [
    ["Carte MVR", video.online],
    ["Flux video", video.videoStatus],
    ["URL MVR", video.mvrUrl],
    ["URL Echo", video.echoUrl]
  ].filter(function(item) { return item[1] && fieldValue(item[1]) !== ""; });
  document.getElementById("mvrVideoSection").hidden = !videoFields.length;
  document.getElementById("mvrVideoGrid").innerHTML = videoFields.map(function(item) {
    return fieldTile(item[0], item[1]);
  }).join("");
}

function renderSimpleStatusSection(sectionId, tableId, items, idKey, labelPrefix) {
  document.getElementById(sectionId).hidden = !items.length;
  document.getElementById(tableId).innerHTML = items.map(function(item) {
    return "<tr>" + cell(labelPrefix + item[idKey]) + cell(fieldValue(item.status)) + "</tr>";
  }).join("");
}

function renderOutputPorts(ports) {
  var body = document.getElementById("portsTable");

  if (!ports.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty">Aucun port de sortie retourne.</td></tr>';
    return;
  }

  body.innerHTML = ports.map(function(port) {
    return "<tr>" +
      cell(port.outputSlotId) +
      cell(port.netPortId) +
      cell(fieldValue(port.fields.netPortLinkStatus)) +
      cell(fieldValue(port.fields.netPortBackupStatus)) +
      cell(fieldValue(port.fields.fiberLinkStatus)) +
      cell(fieldValue(port.fields.workingStatus)) +
    "</tr>";
  }).join("");
}

function renderCards(cards) {
  var body = document.getElementById("cardsTable");

  if (!cards.length) {
    body.innerHTML = '<tr><td colspan="8" class="empty">Aucune receiving card lue.</td></tr>';
    return;
  }

  body.innerHTML = cards.map(function(card) {
    return "<tr>" +
      cell(card.outputSlotId) +
      cell(card.netPortId) +
      cell(card.recvCardId) +
      cell(fieldValue(card.fields.netPortLinkStatus)) +
      cell(fieldValue(card.fields.workingStatus)) +
      cell(fieldValue(card.fields.temperatureValue)) +
      cell(fieldValue(card.fields.voltageValue)) +
      cell([fieldValue(card.fields.fpgaVersion), fieldValue(card.fields.mcuVersion)].filter(Boolean).join(" / ") || "-") +
    "</tr>";
  }).join("");
}

function renderError(message) {
  document.getElementById("summaryGrid").innerHTML = '<div class="notice">' + escapeHtml(message) + '</div>';
}
