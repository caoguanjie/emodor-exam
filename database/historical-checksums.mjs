// Operator-approved recovery, 2026-10-28. Original SQL files are unavailable.
// These are exact observed historical -> checked-in digest pairs, not claims
// that the lost SQL was identical. Applied checkpoints and effective invariants
// must also pass in migrate.mjs. Never overwrite the recorded historical digest.
export const HISTORICAL_CHECKSUMS = Object.freeze({
  '035_role_management': Object.freeze({
    recorded: 'e64b0ea49e84b82d47f624aaced3841cb6e56ed41327586749d896ff9567b5c9',
    current: 'afd37c6a04ab5e51e9d1857551fe1b485e9313fad80506b1272b7af1064ab3f9',
  }),
  '036_role_menu_button_permissions': Object.freeze({
    recorded: 'e9a90c98ec0444e82eb21dcdfc804f524918468e7cefcb3ab524732bbe4afae0',
    current: '10775650b6da3927408183e5bbf6f627bd4b2c88ef7f9e59c660566575e0d2ce',
  }),
  '037_dictionary_types': Object.freeze({
    recorded: 'e9303855bfa66192d36c5d63a9c58f1b2007ec7caa67b7753869294d75624169',
    current: '2c21fdb0241ba1f5cc7cb51d598dc31910f15ef25e6f2cbf7495d8b8fe720fd4',
  }),
});

export function matchesHistoricalChecksum(row, migration) {
  const approved = HISTORICAL_CHECKSUMS[migration.id];
  return !!approved && row.migration_id === migration.id && row.status === 'applied'
    && row.checksum === approved.recorded && migration.checksum === approved.current;
}
