//go:build windows

// dock-drag tells the Bot floating window when a drag starts or ends in another application, so
// the window can grow into its drop target before the pointer reaches it. Electron cannot see a
// drag that has not entered one of its windows; macOS reads the drag pasteboard for this, and
// this is the Windows counterpart.
//
// Usage: dock-drag.exe --watch-file-drag [--file-drop-directory <dir>] [--debug]
//
// stdout: "ready drag", then "drag-start" / "drag-end".
// stdin:  ignored; end of input exits, because the parent went away.
// stderr: with --debug, one line each time the sampled state changes.
//
// The options the macOS helper takes are accepted and ignored, so the same caller drives both.
package main

import (
	"fmt"
	"io"
	"os"
	"syscall"
	"time"
	"unsafe"
)

const (
	pollInterval = 30 * time.Millisecond

	vkLButton    = 0x01
	vkRButton    = 0x02
	smSwapButton = 23
)

var (
	user32           = syscall.NewLazyDLL("user32.dll")
	getAsyncKeyState = user32.NewProc("GetAsyncKeyState")
	getSystemMetrics = user32.NewProc("GetSystemMetrics")
	findWindowEx     = user32.NewProc("FindWindowExW")
	isWindowVisible  = user32.NewProc("IsWindowVisible")

	// Kept in a package variable so the pointer handed to Windows stays valid.
	dragImageClass, _ = syscall.UTF16PtrFromString("SysDragImage")
)

// primaryButtonDown reports whether the button people drag with is held. GetAsyncKeyState reads
// the physical buttons, so a swapped mouse (left-handed setting) is read from the right one.
func primaryButtonDown() bool {
	key := uintptr(vkLButton)
	if swapped, _, _ := getSystemMetrics.Call(smSwapButton); int32(swapped) != 0 {
		key = vkRButton
	}
	state, _, _ := getAsyncKeyState.Call(key)
	// The result is a SHORT: only its low 16 bits are defined.
	return uint16(state)&0x8000 != 0
}

// dragImageVisible reports whether the shell is showing a drag image.
func dragImageVisible() bool {
	var previous uintptr
	for {
		window, _, _ := findWindowEx.Call(0, previous, uintptr(unsafe.Pointer(dragImageClass)), 0)
		if window == 0 {
			return false
		}
		if visible, _, _ := isWindowVisible.Call(window); visible != 0 {
			return true
		}
		// A hidden leftover does not count; look at the next window of the class.
		previous = window
	}
}

func main() {
	debug := false
	for _, arg := range os.Args[1:] {
		if arg == "--debug" {
			debug = true
		}
	}

	go func() {
		// The parent closes the pipe when it stops this process or exits.
		_, _ = io.Copy(io.Discard, os.Stdin)
		os.Exit(0)
	}()

	var detector dragDetector
	var lastPressed, lastImage bool
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()
	fmt.Println("ready drag")
	for range ticker.C {
		pressed := primaryButtonDown()
		// Looking for the window costs more than reading a button, so only while one is held.
		image := pressed && dragImageVisible()
		if debug && (pressed != lastPressed || image != lastImage) {
			lastPressed, lastImage = pressed, image
			fmt.Fprintf(os.Stderr, "pressed=%t dragImage=%t\n", pressed, image)
		}
		if event := detector.update(pressed, image); event != "" {
			fmt.Println(event)
		}
	}
}
