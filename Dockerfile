# Stage 1: Build the .NET Web API
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Copy project definition and restore dependencies
COPY ["Backend/Backend.csproj", "Backend/"]
RUN dotnet restore "Backend/Backend.csproj"

# Copy source code and shared taxonomy files
COPY Backend/ Backend/
COPY shared/ shared/

# Build and publish
WORKDIR "/src/Backend"
RUN dotnet publish "Backend.csproj" -c Release -o /app/publish /p:UseAppHost=false

# Stage 2: Runtime image with .NET 10 + Python verification dependencies
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app

# Install Python 3, pip, and required system tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-setuptools \
    && ln -sf /usr/bin/python3 /usr/bin/python \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python analysis tools (pytest, radon, mypy, semgrep)
COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt semgrep

# Copy published .NET application
COPY --from=build /app/publish .

# Render defaults to port 10000; ASP.NET Core will bind to this port
ENV ASPNETCORE_HTTP_PORTS=10000
EXPOSE 10000

# Start the application using a shell wrapper to respect Render's $PORT if overridden
ENTRYPOINT ["sh", "-c", "dotnet Backend.dll --urls http://0.0.0.0:${PORT:-10000}"]
