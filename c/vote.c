// A simple vote type script
#include "blockchain.h"
#include "ckb_syscalls.h"
#include "ckb_type_id.h"

#define ERROR_INVALID_DATA -1
#define ERROR_ENCODING -2
#define ERROR_OVERFLOWING -3

int main() {
  // Type ID is leveraged here to ensure only one vote cell exists in CKB.
  uint8_t type_id[32];
  int ret = ckb_load_type_id_from_script_args(0, type_id);
  if (ret != CKB_SUCCESS) {
    return ret;
  }
  ret = ckb_validate_type_id(type_id);
  if (ret != CKB_SUCCESS) {
    return ret;
  }

  uint32_t input_votes[64];
  uint32_t output_votes[64];
  // One thing you might find here, is that there is no solution to destroy a
  // cell after the voting period is over. For a demo dapp, we will opt for the
  // simple path by not supporting destroying cells. In a production setup, you
  // might want to add additional logic so certain vote creator can collect
  // votes, then destroying the cell to free up the used CKB. One suggestion,
  // would be to put a lock script hash in current script args, then only allow
  // destroying cells, when one input cell in current transaction use the lock
  // script which has the same hash as the included lock script hash. Note this
  // is exactly how owner lock works in Simple UDT script.
  uint64_t len = 256;
  ret = ckb_checked_load_cell_data(input_votes, &len, 0, 0,
                                   CKB_SOURCE_GROUP_INPUT);
  if (ret != CKB_SUCCESS) {
    return ret;
  }
  if (len % 4 != 0) {
    return ERROR_INVALID_DATA;
  }
  uint8_t input_options = len / 4;
  len = 256;
  ret = ckb_checked_load_cell_data(output_votes, &len, 0, 0,
                                   CKB_SOURCE_GROUP_OUTPUT);
  if (ret != CKB_SUCCESS) {
    return ret;
  }
  if (len % 4 != 0) {
    return ERROR_INVALID_DATA;
  }
  uint8_t output_options = len / 4;
  if (input_options != output_options) {
    return ERROR_INVALID_DATA;
  }

  uint8_t witness[32768];
  len = 32768;
  ret = ckb_checked_load_witness(witness, &len, 0, 0, CKB_SOURCE_GROUP_INPUT);
  if (ret != CKB_SUCCESS) {
    return ret;
  }
  mol_seg_t witness_seg;
  witness_seg.ptr = witness;
  witness_seg.size = len;
  if (MolReader_WitnessArgs_verify(&witness_seg, false) != MOL_OK) {
    return ERROR_ENCODING;
  }
  mol_seg_t input_type_seg = MolReader_WitnessArgs_get_input_type(&witness_seg);
  if (MolReader_BytesOpt_is_none(&input_type_seg)) {
    return ERROR_ENCODING;
  }
  mol_seg_t input_type_bytes_seg = MolReader_Bytes_raw_bytes(&input_type_seg);

  // NOTE: pay attention to this, right now, we are limiting ourselves to one
  // vote per transaction. Later we will relax this restriction with the help of
  // CKB aggregators.
  if (input_type_bytes_seg.size != 1) {
    return ERROR_INVALID_DATA;
  }
  uint8_t voted = input_type_bytes_seg.ptr[0];
  uint32_t new_votes = input_votes[voted] + 1;
  if (new_votes < input_votes[voted]) {
    return ERROR_OVERFLOWING;
  }
  input_votes[voted] = new_votes;

  // The votes from output cell must match input cell with updated votes.
  for (uint8_t i = 0; i < input_options; i++) {
    if (input_votes[i] != output_votes[i]) {
      return ERROR_INVALID_DATA;
    }
  }

  return CKB_SUCCESS;
}
