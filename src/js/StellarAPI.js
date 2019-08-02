import * as StellarSdk from 'stellar-sdk'
import axios from 'axios'
import Utils from './utils.js'
import StellarOperations from './StellarOperations.js'
import TransactionLogger from './TransactionLogger.js'

export default class StellarAPI {
  constructor(horizonServer) {
    if (!horizonServer) {
      console.log('StellarAPI constructor missing parameter')
    }

    this._horizonServer = horizonServer
  }

  server() {
    return this._horizonServer.server()
  }

  serverURL() {
    return this._horizonServer.serverURL()
  }

  horizonMetrics() {
    const url = this.serverURL() + '/metrics'

    return axios.get(url)
  }

  accountInfo(publicKey) {
    return this.server().loadAccount(publicKey)
  }

  balances(sourceWallet) {
    return sourceWallet
      .publicKey()
      .then(publicKey => {
        return this.server().loadAccount(publicKey)
      })
      .then(account => {
        const result = []

        account.balances.forEach(balance => {
          if (balance.asset_type === 'native') {
            result.push({
              symbol: 'XLM',
              amount: balance.balance,
              issuer: ''
            })
          } else {
            result.push({
              symbol: balance.asset_code,
              amount: balance.balance,
              issuer: balance.asset_issuer
            })
          }
        })

        return result
      })
  }

  // returns a string, not a float
  balanceForAsset(sourceWallet, asset) {
    return sourceWallet
      .publicKey()
      .then(publicKey => {
        return this.server().loadAccount(publicKey)
      })
      .then(account => {
        for (const balance of account.balances) {
          if (balance.asset_type === 'native') {
            if (asset.isNative()) {
              return balance.balance
            }
          } else {
            if (
              balance.asset_code === asset.getCode() &&
              balance.asset_issuer === asset.getIssuer()
            ) {
              return balance.balance
            }
          }
        }

        return '0'
      })
  }

  paths(sourceKey, destinationPublic, destinationAsset, destinationAmount) {
    return this.server().paths(
      sourceKey,
      destinationPublic,
      destinationAsset,
      destinationAmount
    )
  }

  mergeAccount(sourceWallet, destWallet) {
    let sourcePublicKey = ''
    let destPublicKey = ''

    return sourceWallet
      .publicKey()
      .then(publicKey => {
        sourcePublicKey = publicKey

        return destWallet.publicKey()
      })
      .then(publicKey => {
        destPublicKey = publicKey

        return this.server().loadAccount(publicKey)
      })
      .then(account => {
        // we are using the destWallet to perform the transaction
        // the source wallet could have 1 XLM which would fail tx_insufficient_balance
        const transaction = new StellarSdk.TransactionBuilder(account, {
          fee: StellarSdk.BASE_FEE
        })
          .setTimeout(StellarSdk.TimeoutInfinite)
          .addOperation(
            StellarSdk.Operation.accountMerge({
              destination: destPublicKey,
              source: sourcePublicKey
            })
          )
          .build()

        return destWallet.signTransaction(transaction)
      })
      .then(signedTransaction => {
        // must also sign by source
        return sourceWallet.signTransaction(signedTransaction)
      })
      .then(signedTransaction => {
        return this.submitTransaction(signedTransaction, 'merge account')
      })
  }

  // fundingWallet is normally null unless you want to pay with a different accout for the sourceWallet Account
  manageOffer(
    sourceWallet,
    fundingWallet,
    buying,
    selling,
    amount,
    price,
    offerID = 0,
    additionalSigners = null
  ) {
    return this._processAccounts(sourceWallet, fundingWallet).then(
      accountInfo => {
        const operation = StellarOperations.manageOfferOperation(
          buying,
          selling,
          amount,
          price,
          offerID,
          accountInfo.sourcePublicKey
        )

        return this._submitOperations(
          accountInfo.account,
          'manage offer',
          sourceWallet,
          fundingWallet,
          [operation],
          null,
          additionalSigners
        )
      }
    )
  }

  changeTrust(sourceWallet, fundingWallet, asset, limit) {
    return this._processAccounts(sourceWallet, fundingWallet).then(
      accountInfo => {
        const operation = StellarOperations.changeTrustOperation(
          asset,
          limit,
          accountInfo.sourcePublicKey
        )

        return this._submitOperations(
          accountInfo.account,
          'change trust',
          sourceWallet,
          fundingWallet,
          [operation]
        )
      }
    )
  }

  allowTrust(sourceWallet, destWallet, asset, authorize, fundingWallet = null) {
    let destPublicKey = null

    return destWallet
      .publicKey()
      .then(publicKey => {
        destPublicKey = publicKey

        return this._processAccounts(sourceWallet, fundingWallet)
      })
      .then(accountInfo => {
        const operation = StellarOperations.allowTrustOperation(
          destPublicKey,
          asset,
          authorize,
          accountInfo.sourcePublicKey
        )

        return this._submitOperations(
          accountInfo.account,
          'allow trust',
          sourceWallet,
          fundingWallet,
          [operation]
        )
      })
  }

  // pass 1 for threshold if either account can sign for med/high operations
  makeMultiSig(
    sourceWallet,
    secondWallet,
    fundingWallet = null,
    threshold = 2
  ) {
    let secondPublicKey = null

    return secondWallet
      .publicKey()
      .then(publicKey => {
        secondPublicKey = publicKey

        return this._processAccounts(sourceWallet, fundingWallet)
      })
      .then(accountInfo => {
        const operations = StellarOperations.multisigOperations(
          secondPublicKey,
          1,
          threshold,
          threshold,
          accountInfo.sourcePublicKey
        )

        return this._submitOperations(
          accountInfo.account,
          'make multisig',
          sourceWallet,
          fundingWallet,
          operations
        )
      })
  }

  removeMultiSig(sourceWallet, secondWallet, transactionOpts) {
    return this.removeMultiSigTransaction(
      sourceWallet,
      secondWallet,
      transactionOpts
    ).then(transaction => {
      return this.submitTransaction(transaction, 'remove multisig')
    })
  }

  submitTransaction(transaction, label) {
    return this.server()
      .submitTransaction(transaction)
      .then(result => {
        // log successful transactions
        TransactionLogger.log(result, label)

        return result
      })
  }

  removeMultiSigTransaction(sourceWallet, secondWallet, transactionOpts) {
    let sourceAccount = null

    return sourceWallet
      .publicKey()
      .then(publicKey => {
        return this.server().loadAccount(publicKey)
      })
      .then(account => {
        sourceAccount = account

        return secondWallet.publicKey()
      })
      .then(secondPublicKey => {
        const builder = new StellarSdk.TransactionBuilder(
          sourceAccount,
          transactionOpts
        ).setTimeout(StellarSdk.TimeoutInfinite)

        const operations = StellarOperations.removeMultisigOperations(
          secondPublicKey,
          1,
          1,
          null
        )
        for (const operation of operations) {
          builder.addOperation(operation)
        }

        const transaction = builder.build()

        return sourceWallet.signTransaction(transaction)
      })
      .then(signedTransaction => {
        return secondWallet.signTransaction(signedTransaction)
      })
  }

  sendAssetBatch(
    sourceWallet,
    fundingWallet,
    destWallets,
    amount,
    inAsset = null,
    memo = null,
    additionalSigners = null
  ) {
    const asset = inAsset === null ? StellarSdk.Asset.native() : inAsset
    let destKey = null
    const operations = []

    return this._processAccounts(sourceWallet, fundingWallet).then(
      accountInfo => {
        let nextPromise = Promise.resolve()

        for (const destWallet of destWallets) {
          nextPromise = nextPromise
            .then(() => {
              return destWallet.publicKey()
            })
            .then(publicKey => {
              destKey = publicKey

              const operation = StellarOperations.paymentOperation(
                destKey,
                amount,
                asset,
                accountInfo.sourcePublicKey
              )
              operations.push(operation)
              return null
            })
        }

        return nextPromise.then(() => {
          return this._submitOperations(
            accountInfo.account,
            'send asset batch',
            sourceWallet,
            fundingWallet,
            operations,
            memo,
            additionalSigners
          )
        })
      }
    )
  }

  sendAsset(
    sourceWallet,
    fundingWallet,
    destWallet,
    amount,
    inAsset = null,
    memo = null,
    additionalSigners = null
  ) {
    const asset = inAsset === null ? StellarSdk.Asset.native() : inAsset
    let destKey = null

    return destWallet
      .publicKey()
      .then(publicKey => {
        destKey = publicKey
        return this.server().loadAccount(destKey)
      })
      .then(destAccount => {
        return this._processAccounts(sourceWallet, fundingWallet)
      })
      .then(accountInfo => {
        const operation = StellarOperations.paymentOperation(
          destKey,
          amount,
          asset,
          accountInfo.sourcePublicKey
        )

        return this._submitOperations(
          accountInfo.account,
          'send asset',
          sourceWallet,
          fundingWallet,
          [operation],
          memo,
          additionalSigners
        )
      })
  }

  buyTokens(
    sourceWallet,
    sendAsset,
    destAsset,
    sendMax,
    destAmount,
    fundingWallet = null,
    additionalSigners = null
  ) {
    let sourcePublicKey = null

    return sourceWallet
      .publicKey()
      .then(publicKey => {
        sourcePublicKey = publicKey
        return this.server().loadAccount(publicKey)
      })
      .then(account => {
        return this._processAccounts(sourceWallet, fundingWallet)
      })
      .then(accountInfo => {
        const operation = StellarOperations.pathPaymentOperation(
          sourcePublicKey,
          sendAsset,
          sendMax,
          destAsset,
          destAmount,
          accountInfo.sourcePublicKey
        )

        return this._submitOperations(
          accountInfo.account,
          'buy asset',
          sourceWallet,
          fundingWallet,
          [operation],
          null,
          additionalSigners
        )
      })
  }

  manageData(
    sourceWallet,
    fundingWallet,
    name,
    value,
    additionalSigners = null
  ) {
    return this._processAccounts(sourceWallet, fundingWallet).then(
      accountInfo => {
        const operation = StellarOperations.manageDataOperation(
          name,
          value,
          accountInfo.sourcePublicKey
        )

        return this._submitOperations(
          accountInfo.account,
          'manage data',
          sourceWallet,
          fundingWallet,
          [operation],
          null,
          additionalSigners
        )
      }
    )
  }

  // swap assets one for one.
  atomicSwap(
    walletOne,
    assetOne,
    walletTwo,
    assetTwo,
    fundingWallet,
    amount,
    additionalSigners = null
  ) {
    let walletOnePublicKey
    let walletTwoPublicKey

    return walletOne
      .publicKey()
      .then(publicKey => {
        walletOnePublicKey = publicKey
        return walletTwo.publicKey()
      })
      .then(publicKey => {
        walletTwoPublicKey = publicKey

        // walletOne doesn't matter, just need the funding wallet account
        return this._processAccounts(walletOne, fundingWallet)
      })
      .then(accountInfo => {
        const sendOne = StellarOperations.paymentOperation(
          walletTwoPublicKey,
          amount,
          assetOne,
          walletOnePublicKey
        )
        const sendTwo = StellarOperations.paymentOperation(
          walletOnePublicKey,
          amount,
          assetTwo,
          walletTwoPublicKey
        )

        let signers = [walletTwo]
        if (additionalSigners) {
          signers = signers.concat(additionalSigners)
        }

        return this._submitOperations(
          accountInfo.account,
          'atomic swap',
          walletOne,
          fundingWallet,
          [sendOne, sendTwo],
          null,
          signers
        )
      })
  }

  getFlags(sourceWallet) {
    return sourceWallet
      .publicKey()
      .then(publicKey => {
        return this.server().loadAccount(publicKey)
      })
      .then(account => {
        let result = 0

        if (account.flags.auth_required) {
          result |= StellarSdk.AuthRequiredFlag
        }
        if (account.flags.auth_revocable) {
          result |= StellarSdk.AuthRevocableFlag
        }

        return result
      })
  }

  createAccount(sourceWallet, newWallet, startingBalance) {
    let newKey

    return newWallet
      .publicKey()
      .then(publicKey => {
        newKey = publicKey

        return sourceWallet.publicKey()
      })
      .then(publicKey => {
        return this.server().loadAccount(publicKey)
      })
      .then(account => {
        const options = {
          destination: newKey,
          startingBalance: startingBalance
        }

        const transaction = new StellarSdk.TransactionBuilder(account, {
          fee: StellarSdk.BASE_FEE
        })
          .setTimeout(StellarSdk.TimeoutInfinite)
          .addOperation(StellarSdk.Operation.createAccount(options))
          .build()

        return sourceWallet.signTransaction(transaction)
      })
      .then(signedTransaction => {
        return this.submitTransaction(signedTransaction, 'create account')
      })
      .then(response => {
        return this.server().loadAccount(newKey)
      })
  }

  // presets are 'lock', 'low'
  lockAccount(
    sourceWallet,
    preset = 'invalid',
    fundingWallet = null,
    additionalSigners = null
  ) {
    let options = null

    switch (preset) {
      case 'low':
        // this allows 'allowTrust', but nothing else high or medium
        options = {
          masterWeight: 1,
          lowThreshold: 0,
          medThreshold: 2,
          highThreshold: 2
        }
        break
      case 'lock':
        // completely locked (unless other signers are set)
        // make sure everything is setup before doing this. Not reversible
        options = {
          masterWeight: 0,
          lowThreshold: 0,
          medThreshold: 0,
          highThreshold: 0
        }
        break
      default:
        // will throw an error below, options will be null
        console.log('preset invalid: ' + preset)
        break
    }

    if (!options) {
      throw new Error('lockAccount preset invalid')
    }

    return this.setOptions(
      sourceWallet,
      options,
      fundingWallet,
      additionalSigners
    )
  }

  setDomain(
    sourceWallet,
    domain,
    fundingWallet = null,
    additionalSigners = null
  ) {
    const options = {
      homeDomain: domain
    }

    return this.setOptions(
      sourceWallet,
      options,
      fundingWallet,
      additionalSigners
    )
  }

  setFlags(
    sourceWallet,
    flags,
    fundingWallet = null,
    additionalSigners = null
  ) {
    const options = {
      setFlags: flags
    }

    return this.setOptions(
      sourceWallet,
      options,
      fundingWallet,
      additionalSigners
    )
  }

  clearFlags(
    sourceWallet,
    flags,
    fundingWallet = null,
    additionalSigners = null
  ) {
    const options = {
      clearFlags: flags
    }

    return this.setOptions(
      sourceWallet,
      options,
      fundingWallet,
      additionalSigners
    )
  }

  setInflationDestination(
    sourceWallet,
    inflationDest,
    fundingWallet = null,
    additionalSigners = null
  ) {
    const options = {
      inflationDest: inflationDest
    }

    return this.setOptions(
      sourceWallet,
      options,
      fundingWallet,
      additionalSigners
    )
  }

  setOptions(
    sourceWallet,
    options,
    fundingWallet = null,
    additionalSigners = null
  ) {
    return this._processAccounts(sourceWallet, fundingWallet).then(
      accountInfo => {
        const operation = StellarOperations.setOptionsOperation(
          options,
          accountInfo.sourcePublicKey
        )

        return this._submitOperations(
          accountInfo.account,
          'set options',
          sourceWallet,
          fundingWallet,
          [operation],
          null,
          additionalSigners
        )
      }
    )
  }

  // ======================================================================
  // Multioperation
  // ======================================================================

  multiOperation(sourceWallet, fundingWallet, operationSpecs) {
    let sourcePublicKey = null
    let operations = []

    return sourceWallet
      .publicKey()
      .then(publicKey => {
        sourcePublicKey = publicKey

        return fundingWallet.publicKey()
      })
      .then(publicKey => {
        return this.server().loadAccount(publicKey)
      })
      .then(account => {
        let nextPromise = Promise.resolve()

        for (const spec of operationSpecs) {
          nextPromise = nextPromise.then(() => {
            switch (spec.type) {
              case 'change-trust': {
                const operation = StellarOperations.changeTrustOperation(
                  spec.asset,
                  spec.limit,
                  sourcePublicKey
                )
                operations.push(operation)

                return null
              }
              case 'multisig':
                return spec.secondWallet.publicKey().then(publicKey => {
                  const opts = StellarOperations.multisigOperations(
                    publicKey,
                    1,
                    2,
                    2,
                    sourcePublicKey
                  )

                  operations = operations.concat(opts)

                  return null
                })
              case 'create-account':
                return spec.newWallet.publicKey().then(publicKey => {
                  const options = {
                    destination: publicKey,
                    startingBalance: spec.startingBalance
                  }

                  const operation = StellarSdk.Operation.createAccount(options)
                  operations.push(operation)

                  return null
                })
              default:
                console.log('not handled: ' + spec.type)
                return null
            }
          })
        }

        return nextPromise.then(() => {
          if (operations.length === 0) {
            throw new Error('multi operation failed')
          }

          return this._submitOperations(
            account,
            'multi-operation',
            sourceWallet,
            fundingWallet,
            operations
          )
        })
      })
  }

  // ======================================================================
  // Private
  // ======================================================================

  _processAccounts(sourceWallet, fundingWallet) {
    return sourceWallet
      .publicKey()
      .then(publicKey => {
        if (fundingWallet) {
          return fundingWallet.publicKey().then(fundingPublicKey => {
            return {
              sourcePublicKey: publicKey,
              fundingPublicKey: fundingPublicKey
            }
          })
        }

        return {
          sourcePublicKey: publicKey
        }
      })
      .then(result => {
        let publicKey = result.sourcePublicKey
        if (result.fundingPublicKey) {
          publicKey = result.fundingPublicKey
        }

        return this.server()
          .loadAccount(publicKey)
          .then(account => {
            result.account = account

            return result
          })
      })
  }

  _submitOperations(
    account,
    label,
    sourceWallet,
    fundingWallet,
    operations,
    memo = null,
    additionalSigners = null
  ) {
    const builder = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE
    }).setTimeout(StellarSdk.TimeoutInfinite)

    for (const operation of operations) {
      builder.addOperation(operation)
    }

    if (Utils.strOK(memo)) {
      builder.addMemo(StellarSdk.Memo.text(memo))
    }

    const transaction = builder.build()

    return sourceWallet
      .signTransaction(transaction)
      .then(signedTx => {
        // don't sign if funder and source are the same
        if (fundingWallet && !fundingWallet.equalTo(sourceWallet)) {
          return fundingWallet.signTransaction(signedTx)
        }

        return signedTx
      })
      .then(signedTx => {
        if (additionalSigners && additionalSigners.length > 0) {
          // will fail if additional signers also include the source and funding
          const excludeList = []
          excludeList.push(sourceWallet)

          if (fundingWallet) {
            excludeList.push(fundingWallet)
          }

          const signers = this._filteredSigners(additionalSigners, excludeList)
          if (signers.length > 0) {
            let nextPromise = Promise.resolve()

            for (const signerWallet of signers) {
              nextPromise = nextPromise.then(() => {
                return signerWallet.signTransaction(signedTx)
              })
            }

            return nextPromise.then(signedTxMore => {
              return this.submitTransaction(signedTxMore, label)
            })
          }
        }

        return this.submitTransaction(signedTx, label)
      })
  }

  _filteredSigners(signers, excludeList) {
    let result = signers

    if (
      signers &&
      signers.length > 0 &&
      excludeList &&
      excludeList.length > 0
    ) {
      result = []

      for (const signer of signers) {
        // avoid nulls in array: [null]
        if (signer) {
          let found = false

          for (const exclude of excludeList) {
            if (signer.equalTo(exclude)) {
              found = true
              break
            }
          }

          if (!found) {
            result.push(signer)
          }
        }
      }
    }

    return result
  }
}
