using Backend.Services;
using Backend.Services.Taxonomy;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Add CORS
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyMethod()
              .AllowAnyHeader();
    });
});

// Register AI Service. The per-request timeout comes from Llm:TimeoutSeconds and is
// enforced by AiService itself, so HttpClient's own 100 s default is disabled.
builder.Services.Configure<LlmClientOptions>(builder.Configuration.GetSection(LlmClientOptions.SectionName));
builder.Services.AddHttpClient<AiService>(client => client.Timeout = Timeout.InfiniteTimeSpan);
builder.Services.AddTransient<ILlmClient>(sp => sp.GetRequiredService<AiService>());
builder.Services.AddSingleton<VerificationService>();
builder.Services.AddScoped<OptimizationService>();

// Shared Taxonomy_Definition (Taxonomy:DefinitionPath, default shared/taxonomy.v1.json
// under the app base directory). Loaded on first resolution; an invalid file throws
// TaxonomyLoadException.
builder.Services.AddSingleton<ITaxonomyProvider>(sp =>
    TaxonomyProvider.LoadOrThrow(sp.GetRequiredService<IConfiguration>()));

// Keep-alive service to prevent Render from idling
builder.Services.AddHttpClient("KeepAliveClient");
builder.Services.AddHostedService<KeepAliveService>();

var app = builder.Build();

// Enable Swagger in all environments so you can test endpoints from your browser
app.UseSwagger();
app.UseSwaggerUI(c =>
{
    c.SwaggerEndpoint("/swagger/v1/swagger.json", "MACI Backend API v1");
    c.RoutePrefix = "swagger";
});

app.UseHttpsRedirection();

app.UseCors("AllowAll");

app.UseAuthorization();

// Root route so visiting the base URL in a browser shows online status instead of 404
app.MapGet("/", () => Results.Ok(new
{
    status = "online",
    service = "MACI Backend API",
    time = DateTime.UtcNow.ToString("o"),
    documentation = "/swagger",
    health = "/api/health"
}));

app.MapControllers();

app.Run();

// Exposes the entry point type to WebApplicationFactory<Program> in Backend.Tests.
public partial class Program { }
