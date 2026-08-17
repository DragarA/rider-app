FROM eclipse-temurin:21-jre-jammy

ARG GH_VERSION=9.1
WORKDIR /graphhopper

RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fL -o graphhopper.jar \
  "https://repo1.maven.org/maven2/com/graphhopper/graphhopper-web/${GH_VERSION}/graphhopper-web-${GH_VERSION}.jar"

EXPOSE 8989

# config.yml and /data are bind-mounted at runtime (see docker-compose.yml).
ENTRYPOINT ["java", "-Ddw.graphhopper.datareader.file=/data/slovenia-latest.osm.pbf", \
  "-jar", "graphhopper.jar", "server", "config.yml"]
