interface UserStock {
  id: string
  uid: string
  symbol: string
  quantity: number
  purchasePrice: number | null
  purchaseDate: Date | null
  createdAt: Date
  updatedAt: Date
}

export default UserStock

