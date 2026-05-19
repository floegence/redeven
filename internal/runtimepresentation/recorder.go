package runtimepresentation

type Recorder struct {
	Started []Snapshot
	Events  []Event
	Results []Result
}

func (r *Recorder) Start(snapshot Snapshot) error {
	r.Started = append(r.Started, snapshot)
	return nil
}

func (r *Recorder) Emit(event Event) error {
	r.Events = append(r.Events, event)
	return nil
}

func (r *Recorder) Close(result Result) error {
	r.Results = append(r.Results, result)
	return nil
}
