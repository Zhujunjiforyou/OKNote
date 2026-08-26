function calendarMinimumForWorkArea(workArea) {
  return {
    width: Math.min(344, Math.max(320, Number(workArea && workArea.width) - 16)),
    height: Math.min(284, Math.max(260, Number(workArea && workArea.height) - 16)),
  };
}

function noteMinimumForWorkArea(workArea) {
  return {
    width: Math.min(160, Math.max(120, Number(workArea && workArea.width) - 16)),
    height: Math.min(170, Math.max(120, Number(workArea && workArea.height) - 16)),
  };
}

module.exports = { calendarMinimumForWorkArea, noteMinimumForWorkArea };
