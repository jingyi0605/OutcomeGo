//go:build !windows

package main

import (
	"fmt"
	"os"
)

// The helper only exists for Windows; this keeps `go vet` and `go test` working elsewhere.
func main() {
	fmt.Fprintln(os.Stderr, "dock-drag: Windows only")
	os.Exit(1)
}
