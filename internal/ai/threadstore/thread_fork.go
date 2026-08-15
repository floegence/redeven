package threadstore

type ForkThreadRequest struct {
	OperationID           string
	ClientRequestID       string
	LogicalRequestID      string
	TitleLogicalRequestID string
	EndpointID            string
	SourceThreadID        string
	DestinationThreadID   string
	Title                 string
	CreatedByUserPublicID string
	CreatedByUserEmail    string
	CreatedAtUnixMs       int64
}
