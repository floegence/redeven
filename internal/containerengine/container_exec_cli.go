package containerengine

import "context"

func (c *CLIClient) ContainerExecProgram(ctx context.Context, req ContainerExecRequest) (ProgramSpec, error) {
	args := []string{"exec", "--interactive", "--tty", req.ContainerID}
	args = append(args, req.Argv...)
	return ProgramSpec{
		Executable: string(req.Engine),
		Args:       endpointArgs(ctx, req.Engine, args),
	}, nil
}
