function hasRevisionConflict(expectedRevision, currentRevision) {
  return Number.isInteger(expectedRevision) && expectedRevision !== currentRevision;
}

module.exports = { hasRevisionConflict };
