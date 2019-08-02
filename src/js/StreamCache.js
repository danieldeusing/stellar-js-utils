export default class StreamCache {
  constructor(horizon, type, publicKey, order) {
    // vars
    this.type = type
    this.horizon = horizon
    this.order = order

    this.records = []
    this.index = -1
    this.pagingToken = 0
    this.publicKey = publicKey
    this.reachedEnd = false
    this.loading = false
  }

  recordForIndex(nextIndex) {
    if (nextIndex >= 0 && nextIndex < this.records.length) {
      this.index = nextIndex
    } else {
      if (nextIndex > 0) {
        this.index = this.records.length - 1
      } else {
        this.index = 0
      }
    }

    if (this.records.length > 0) {
      const record = this.records[this.index]

      const result = {
        index: this.index,
        record: record
      }

      return result
    }

    return {}
  }

  getCurrentPage(increment) {
    return new Promise((resolve, reject) => {
      if (increment) {
        const nextIndex = this.index + 1

        if (nextIndex >= this.records.length) {
          if (this.reachedEnd) {
            resolve(this.recordForIndex(nextIndex))
          } else {
            return this.loadNextPage()
              .then(() => {
                resolve(this.recordForIndex(nextIndex))
              })
          }
        } else {
          resolve(this.recordForIndex(nextIndex))
        }
      } else {
        const nextIndex = this.index - 1

        resolve(this.recordForIndex(nextIndex))
      }
    })
  }

  next() {
    return this.getCurrentPage(true)
  }

  previous() {
    return this.getCurrentPage(false)
  }

  loadNextPage() {
    return new Promise((resolve, reject) => {
      if (this.loading) {
        // only load one batch at a time
        console.log('loading')
        resolve(null)
      } else {
        this.loading = true

        let builder
        switch (this.type) {
          case 'payments':
            builder = this.horizon.server().payments()
            break
          case 'transactions':
            builder = this.horizon.server().transactions()
            break
          case 'operations':
            builder = this.horizon.server().operations()
            break
          case 'effects':
            builder = this.horizon.server().effects()
            break
          default:
            break
        }

        builder.limit(4)
          .order(this.order)

        if (this.pagingToken !== 0) {
          builder.cursor(this.pagingToken)
        }

        builder.forAccount(this.publicKey)

        return builder.call()
          .then((response) => {
            if (response.records.length > 0) {
              this.records = this.records.concat(response.records)

              const last = response.records.length - 1

              this.pagingToken = response.records[last].paging_token
            } else {
              console.log('reached end')
              this.reachedEnd = true
            }

            this.loading = false
            resolve(null)
          })
          .catch((error) => {
            this.loading = false
            console.log(error, 'Error')

            reject(null)
          })
      }
    })
  }
}