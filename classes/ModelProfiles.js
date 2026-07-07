const MODEL_PROFILES = {
  H5: {
    model: "H5",
    label: "NovaStar H5",
    maxInputSlots: 10,
    maxOutputSlots: 3
  },
  H9: {
    model: "H9",
    label: "NovaStar H9",
    maxInputSlots: 15,
    maxOutputSlots: 5
  }
};

function normalizeModel(value) {
  const model = String(value || "H9").toUpperCase();
  return MODEL_PROFILES[model] ? model : "H9";
}

function getProfile(value) {
  return MODEL_PROFILES[normalizeModel(value)];
}

module.exports = {
  MODEL_PROFILES,
  normalizeModel,
  getProfile
};
