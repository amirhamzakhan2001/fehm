package main

import (
	"fmt"
	"strings"
)

// Invoice is a billable document.
type Invoice struct {
	ID    string
	Total int
}

// Biller issues invoices.
type Biller interface {
	Issue(inv Invoice) error
}

// NewInvoice builds an invoice for an order.
func NewInvoice(id string, total int) Invoice {
	return Invoice{ID: strings.ToUpper(id), Total: total}
}

func (i *Invoice) Describe() string {
	return fmt.Sprintf("%s: %d", i.ID, i.Total)
}

func main() {
	inv := NewInvoice("a1", 100)
	fmt.Println(inv.Describe())
}
