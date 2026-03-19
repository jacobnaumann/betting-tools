const SPINNER_CLICK_ZONE_PX = 28;

export function clearNumberInputUnlessSpinnerClick(event, clearValue) {
  const input = event.currentTarget;
  if (!input || input.type !== 'number') {
    clearValue();
    return;
  }

  const bounds = input.getBoundingClientRect();
  const nativeEvent = event.nativeEvent;
  const offsetX = Number.isFinite(nativeEvent?.offsetX)
    ? nativeEvent.offsetX
    : event.clientX - bounds.left;
  const spinnerZoneStart = bounds.width - SPINNER_CLICK_ZONE_PX;
  const isSpinnerClick = offsetX >= spinnerZoneStart;

  if (!isSpinnerClick) {
    clearValue();
  }
}
