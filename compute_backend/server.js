const deepEql = require("deep-eql");

const { core } = require("@ckb-lumos/base");
const { WitnessArgs } = core;

const { initializeConfig } = require("@ckb-lumos/config-manager");
initializeConfig();

const { Indexer } = require("@ckb-lumos/indexer");
const indexer = new Indexer("http://127.0.0.1:9115/rpc", "./indexed-data");
indexer.startForever();

const { RPC, Reader } = require("ckb-js-toolkit");
const indexerRpc = new RPC("http://127.0.0.1:9115/indexer_rpc");

const jsonrpc = require("json-rpc2");
const server = jsonrpc.Server.$create({
  websocket: true,
  headers: {
    "Access-Control-Allow-Origin": "*",
  },
});

function parseVoteData(data) {
  const view = new DataView(new Reader(data).toArrayBuffer());
  if (view.byteLength < 4 || view.byteLength % 4 !== 0) {
    throw new Error("Invalid data length!");
  }
  const count = view.getUint32(0, true);
  if (view.byteLength != count * 4 + 4) {
    throw new Error("Invalid data length!");
  }
  const results = [];
  for (let i = 0; i < count; i++) {
    results.push(view.getUint32(4 + i * 4, true));
  }
  return results;
}

function serializeVoteData(votes) {
  const buffer = new ArrayBuffer(4 + votes.length * 4);
  const view = new DataView(buffer);
  view.setUint32(0, votes.length, true);
  for (let i = 0; i < votes.length; i++) {
    view.setUint32(4 + i * 4, votes[i], true);
  }
  return new Reader(buffer).serializeJson();
}

function parseAction(actionData) {
  const view = new DataView(new Reader(data).toArrayBuffer());
  if (view.byteLength !== 4) {
    throw new Error("Invalid action data length!");
  }
  return {
    index: view.getUint32(0, true),
    votes: 1,
  };
}

async function assembleAsync(args) {
  const searchKey = args[0];
  const partialTransactions = args[1];

  const { objects } = await indexerRpc.get_cells(searchKey, "desc", "0x2");
  if (objects.length !== 1) {
    throw new Error("The query must return exactly one cell!");
  }
  const cell = objects[0];

  const votes = parseVoteData(cell.output_data);
  for (const partialTx of partialTransactions) {
    const witnessArgs = new WitnessArgs(new Reader(partialTx.witnesses[0]));
    const inputType = witnessArgs.getInputType();
    if (!inputType.hasValue()) {
      throw new Error("Action is missing!");
    }
    const action = parseAction(inputType.value().raw());
    if (action.index < 0 || action.index >= votes.length) {
      throw new Error("Invalid action index!");
    }
    // TODO: overflow check
    votes[action.index] += action.votes;
  }

  const voteData = serializeVoteData(votes);
  const tx = {
    version: "0x0",
    cell_deps: [],
    header_deps: [],
    inputs: [
      {
        previous_output: cell.out_point,
        since: "0x0",
      },
    ],
    outputs: [cell.output],
    outputs_data: [voteData],
    witnesses: ["0x"],
  };
  for (const partialTx of partialTransactions) {
    if (partialTx.inputs.length !== partialTx.witnesses.length) {
      throw new Error("Input and witness length does not match!");
    }
    // Add each unique cell dep
    for (const cellDep of partialTx.cell_deps) {
      if (tx.cell_deps.every((cd) => !deepEql(cellDep, cd))) {
        tx.cell_deps.push(cellDep);
      }
    }
    // TODO: some scripts(such as NervosDAO) uses fixed header dep location,
    // for now, this simple solution does not have a solution for fixed header
    // dep. Hence we do not deal with header deps in partial transaction now.

    // Add each cell input, output and witness
    for (const input of partialTx.inputs) {
      tx.inputs.push(input);
    }
    for (const output of partialTx.outputs) {
      tx.outputs.push(output);
    }
    for (const witness of partialTx.witnesses) {
      tx.witnesses.push(witness);
    }
  }

  return tx;
}

function assemble(args, opt, callback) {
  assembleAsync(args)
    .then((result) => callback(null, result))
    .catch((error) => callback(error, null));
}

server.expose("assemble", assemble);
server.listen(8000, "localhost");
