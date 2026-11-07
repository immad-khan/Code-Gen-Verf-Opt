using Backend.Services.Verification.Context;

namespace Backend.Services.Verification.Handlers;

/// <summary>
/// Defines a link in the Chain of Responsibility for code verification.
/// </summary>
public interface IVerificationHandler
{
    IVerificationHandler SetNext(IVerificationHandler next);
    Task HandleAsync(VerificationContext context);
}

/// <summary>
/// Base class implementing the chaining mechanism and fail-fast short-circuiting.
/// </summary>
public abstract class VerificationHandlerBase : IVerificationHandler
{
    protected IVerificationHandler? NextHandler;

    public IVerificationHandler SetNext(IVerificationHandler next)
    {
        NextHandler = next;
        return next;
    }

    public virtual async Task HandleAsync(VerificationContext context)
    {
        await ExecuteAsync(context);

        if (!context.ShouldShortCircuit && NextHandler != null)
        {
            await NextHandler.HandleAsync(context);
        }
    }

    protected abstract Task ExecuteAsync(VerificationContext context);
}
