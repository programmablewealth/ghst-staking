import { sendToMultisig } from "../scripts/libraries/multisig/multisig";
import { AddressZero } from "@ethersproject/constants";
import { task } from "hardhat/config";
import {
  Contract,
  ContractFactory,
  ContractReceipt,
  ContractTransaction,
  PopulatedTransaction,
} from "@ethersproject/contracts";
import { Signer } from "@ethersproject/abstract-signer";

import { OwnershipFacet } from "../typechain/OwnershipFacet";
import { IDiamondCut } from "../typechain/IDiamondCut";
import {
  gasPrice,
  getSelectors,
  getSighashes,
} from "../scripts/helperFunctions";

import { HardhatRuntimeEnvironment } from "hardhat/types";

export interface FacetsAndAddSelectors {
  facetName: string;
  addSelectors: string[];
  removeSelectors: string[];
}

type FacetCutType = { Add: 0; Replace: 1; Remove: 2 };
const FacetCutAction: FacetCutType = { Add: 0, Replace: 1, Remove: 2 };

export interface DeployUpgradeTaskArgs {
  diamondUpgrader: string;
  diamondAddress: string;
  facetsAndAddSelectors: string;
  useMultisig: boolean;
  useLedger: boolean;
  initAddress?: string;
  initCalldata?: string;
  // verifyFacets: boolean;
  // updateDiamondABI: boolean;
}

interface Cut {
  facetAddress: string;
  action: 0 | 1 | 2;
  functionSelectors: string[];
}

export function convertFacetAndSelectorsToString(
  facets: FacetsAndAddSelectors[]
): string {
  let outputString = "";

  facets.forEach((facet) => {
    outputString = outputString.concat(
      `#${facet.facetName}$$$${facet.addSelectors.join(
        "*"
      )}$$$${facet.removeSelectors.join("*")}`
    );
  });

  return outputString;
}

export function convertStringToFacetAndSelectors(
  facets: string
): FacetsAndAddSelectors[] {
  const facetArrays: string[] = facets.split("#").filter((string) => {
    return string.length > 0;
  });

  const output: FacetsAndAddSelectors[] = [];

  facetArrays.forEach((string) => {
    const facetsAndAddSelectors = string.split("$$$");
    output.push({
      facetName: facetsAndAddSelectors[0],
      addSelectors: facetsAndAddSelectors[1].split("*"),
      removeSelectors: facetsAndAddSelectors[2].split("*"),
    });
  });

  return output;
}

task(
  "deployUpgrade",
  "Deploys a Diamond Cut, given an address, facets and addSelectors, and removeSelectors"
)
  .addParam("diamondUpgrader", "Address of the multisig signer")
  .addParam("diamondAddress", "Address of the Diamond to upgrade")
  .addParam(
    "facetsAndAddSelectors",
    "Stringified array of facet names to upgrade, along with an array of add Selectors"
  )
  .addOptionalParam("initAddress", "The facet address to call init function on")
  .addOptionalParam("initCalldata", "The calldata for init function")
  .addFlag(
    "useMultisig",
    "Set to true if multisig should be used for deploying"
  )
  .addFlag("useLedger", "Set to true if Ledger should be used for signing")
  // .addFlag("verifyFacets","Set to true if facets should be verified after deployment")

  .setAction(
    async (taskArgs: DeployUpgradeTaskArgs, hre: HardhatRuntimeEnvironment) => {
      const facets: string = taskArgs.facetsAndAddSelectors;
      const facetsAndAddSelectors: FacetsAndAddSelectors[] =
        convertStringToFacetAndSelectors(facets);
      const diamondUpgrader: string = taskArgs.diamondUpgrader;
      const diamondAddress: string = taskArgs.diamondAddress;
      const useMultisig = taskArgs.useMultisig;
      const useLedger = taskArgs.useLedger;
      const initAddress = taskArgs.initAddress;
      const initCalldata = taskArgs.initCalldata;

      //Instantiate the Signer
      let signer: Signer;
      const owner = await (
        (await hre.ethers.getContractAt(
          "OwnershipFacet",
          diamondAddress
        )) as OwnershipFacet
      ).owner();
      const testing = ["hardhat", "localhost"].includes(hre.network.name);

      if (testing) {
        await hre.network.provider.request({
          method: "hardhat_impersonateAccount",
          params: [owner],
        });
        signer = await hre.ethers.getSigner(owner);
      } else if (hre.network.name === "matic") {
        if (useLedger) {
          const {
            LedgerSigner,
          } = require("../../aavegotchi-contracts/node_modules/@ethersproject/hardware-wallets");

          signer = new LedgerSigner(hre.ethers.provider);
        } else signer = (await hre.ethers.getSigners())[0];
      } else {
        throw Error("Incorrect network selected");
      }

      //Create the cut
      const deployedFacets = [];
      const cut: Cut[] = [];

      for (let index = 0; index < facetsAndAddSelectors.length; index++) {
        const facet = facetsAndAddSelectors[index];

        const factory = (await hre.ethers.getContractFactory(
          facet.facetName
        )) as ContractFactory;
        const deployedFacet: Contract = await factory.deploy({
          gasPrice: gasPrice,
        });
        await deployedFacet.deployed();
        console.log(
          `Deployed Facet Address for ${facet.facetName}:`,
          deployedFacet.address
        );
        deployedFacets.push(deployedFacet);

        //Verify
        if (hre.network.name === "matic") {
          // await hre.run("verify:verify", {
          //   address: deployedFacet.address,
          //   constructorArguments: [],
          // });
        }

        const newSelectors = getSighashes(facet.addSelectors, hre.ethers);
        console.log("new selec:", newSelectors);
        const removeSelectors = getSighashes(facet.removeSelectors, hre.ethers);

        console.log("rem selecs:", removeSelectors);

        let existingFuncs = getSelectors(deployedFacet);

        // const diamondLoupe = await hre.ethers.getContractAt(
        //   "DiamondLoupeFacet",
        //   "0xa02d547512bb90002807499f05495fe9c4c3943f"
        // );

        // console.log("fetching selectors");

        // const selectors = await diamondLoupe.facetFunctionSelectors(
        //   "0x2cE9AD2Cd4709B7640C1024BD75b23ffa82215b8"
        // );
        let extra: string[] = [
          "0xe37ecc3c",
          "0xdf76df5a",
          "0x47d3dc2f",
          "0x3d55abf4",
          "0x24761a68",
        ];

        // existingFuncs.forEach((selector) => {
        //   if (!selectors.includes(selector)) {
        //     extra.push(selector);
        //   }
        // });

        console.log("extra selectors:", extra);

        console.log("existing funcs:", existingFuncs);
        for (const selector of newSelectors) {
          if (!existingFuncs.includes(selector)) {
            const index = newSelectors.findIndex((val) => val == selector);

            throw Error(
              `Selector ${selector} (${facet.addSelectors[index]}) not found`
            );
          }
        }

        // console.log("funcs:", existingFuncs.length);

        let existingSelectors = getSelectors(deployedFacet);
        existingSelectors = existingSelectors.filter(
          (selector) => !newSelectors.includes(selector)
        );

        // console.log("existing selectors:", existingSelectors);

        // console.log("funcs:", existingSelectors.length);

        if (newSelectors.length > 0) {
          cut.push({
            facetAddress: deployedFacet.address,
            action: FacetCutAction.Add,
            functionSelectors: newSelectors,
          });
        }

        //Always replace the existing selectors to prevent duplications

        //remove extra selectors

        existingSelectors = existingSelectors.filter(
          (selector) => !extra.includes(selector)
        );

        console.log("existing length:", existingSelectors.length);

        if (existingSelectors.length > 0)
          cut.push({
            facetAddress: deployedFacet.address,
            action: FacetCutAction.Replace,
            functionSelectors: existingSelectors,
          });

        if (removeSelectors.length > 0) {
          // console.log("Removing selectors:", removeSelectors);
          cut.push({
            facetAddress: hre.ethers.constants.AddressZero,
            action: FacetCutAction.Remove,
            functionSelectors: removeSelectors,
          });
        }
      }

      console.log(cut);

      //Execute the Cut
      const diamondCut = (await hre.ethers.getContractAt(
        "IDiamondCut",
        diamondAddress,
        signer
      )) as IDiamondCut;

      if (testing) {
        console.log("Diamond cut");
        const tx: ContractTransaction = await diamondCut.diamondCut(
          cut,
          initAddress ? initAddress : hre.ethers.constants.AddressZero,
          initCalldata ? initCalldata : "0x",
          { gasLimit: 8000000 }
        );
        console.log("Diamond cut tx:", tx.hash);
        const receipt: ContractReceipt = await tx.wait();
        if (!receipt.status) {
          throw Error(`Diamond upgrade failed: ${tx.hash}`);
        }
        console.log("Completed diamond cut: ", tx.hash);
      } else {
        //Choose to use a multisig or a simple deploy address
        if (useMultisig) {
          console.log("Diamond cut");
          const tx: PopulatedTransaction =
            await diamondCut.populateTransaction.diamondCut(
              cut,
              initAddress ? initAddress : hre.ethers.constants.AddressZero,
              initCalldata ? initCalldata : "0x",
              { gasLimit: 800000 }
            );
          await sendToMultisig(diamondUpgrader, signer, tx, hre.ethers);
        } else {
          const tx: ContractTransaction = await diamondCut.diamondCut(
            cut,
            initAddress ? initAddress : hre.ethers.constants.AddressZero,
            initCalldata ? initCalldata : "0x",
            { gasLimit: 800000, gasPrice: gasPrice }
          );

          const receipt: ContractReceipt = await tx.wait();
          if (!receipt.status) {
            throw Error(`Diamond upgrade failed: ${tx.hash}`);
          }
          console.log("Completed diamond cut: ", tx.hash);
        }
      }
    }
  );
