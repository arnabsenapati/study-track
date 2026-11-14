// Wait briefly after ASAR integrity writes the EXE so Windows Defender releases its scan lock
// before electron-builder's resEdit embeds the custom Windows icon.
module.exports = async function afterPack() {
  await new Promise((resolve) => setTimeout(resolve, 3500));
};
