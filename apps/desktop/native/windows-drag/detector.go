package main

// missesToEnd is how many consecutive samples without a drag image end a drag whose button is
// still held: Esc cancels a drag without releasing the button.
const missesToEnd = 3

// dragDetector turns samples of the primary pointer button and of the drag image into
// "drag-start" and "drag-end" events.
//
// While an OLE drag runs, the shell shows its drag image in a "SysDragImage" window. A window
// move, a text selection or a scrollbar drag never does, so the image is what tells a drag of
// files (or text, or a picture) apart from every other press of the button. The data being
// dragged is only visible to a drop target, so the detector cannot tell files from text: the dock
// page ignores the drags that carry no files.
type dragDetector struct {
	active bool
	misses int
}

// update takes one sample and returns the event it causes: "drag-start", "drag-end", or "".
func (d *dragDetector) update(pressed, imageVisible bool) string {
	if !pressed {
		d.misses = 0
		if d.active {
			d.active = false
			return "drag-end"
		}
		return ""
	}
	if imageVisible {
		d.misses = 0
		if !d.active {
			d.active = true
			return "drag-start"
		}
		return ""
	}
	if d.active {
		d.misses++
		if d.misses >= missesToEnd {
			d.active = false
			d.misses = 0
			return "drag-end"
		}
	}
	return ""
}
