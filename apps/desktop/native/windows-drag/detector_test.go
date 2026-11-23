package main

import "testing"

type sample struct {
	pressed bool
	image   bool
}

func run(samples []sample) []string {
	var detector dragDetector
	events := make([]string, 0, len(samples))
	for _, s := range samples {
		events = append(events, detector.update(s.pressed, s.image))
	}
	return events
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestDragStartsWhenImageAppearsAndEndsOnRelease(t *testing.T) {
	got := run([]sample{
		{false, false},
		{true, false}, // press, nothing dragged yet
		{true, true},  // the drag image appears
		{true, true},
		{false, true}, // release: the image may linger a moment
		{false, false},
	})
	want := []string{"", "", "drag-start", "", "drag-end", ""}
	if !equal(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestPressWithoutDragImageIsNotADrag(t *testing.T) {
	// Moving a window, selecting text and dragging a scrollbar hold the button without an image.
	got := run([]sample{{true, false}, {true, false}, {true, false}, {false, false}})
	want := []string{"", "", "", ""}
	if !equal(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestEscapeEndsADragWhileTheButtonIsStillHeld(t *testing.T) {
	got := run([]sample{
		{true, true},
		{true, false},
		{true, false},
		{true, false}, // third miss in a row
		{true, false},
		{false, false},
	})
	want := []string{"drag-start", "", "", "drag-end", "", ""}
	if !equal(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestBriefImageFlickerDoesNotEndADrag(t *testing.T) {
	got := run([]sample{
		{true, true},
		{true, false},
		{true, true}, // the image came back: the miss count starts over
		{true, false},
		{true, false},
		{true, true},
		{false, false},
	})
	want := []string{"drag-start", "", "", "", "", "", "drag-end"}
	if !equal(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestADragThatStartsAgainAfterEndingIsReported(t *testing.T) {
	got := run([]sample{{true, true}, {false, false}, {true, true}, {false, false}})
	want := []string{"drag-start", "drag-end", "drag-start", "drag-end"}
	if !equal(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
}
