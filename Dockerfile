# keyverse multipack door (Elixir)
FROM hexpm/elixir:1.17.3-erlang-27.2-alpine-3.20.3 AS build
RUN apk add --no-cache build-base git
WORKDIR /app
ENV MIX_ENV=prod
COPY mix.exs mix.lock ./
RUN mix local.hex --force && mix local.rebar --force && mix deps.get --only prod
COPY config config
COPY lib lib
COPY priv priv
COPY words-door.txt words-door.txt
RUN mix compile

FROM hexpm/elixir:1.17.3-erlang-27.2-alpine-3.20.3
RUN apk add --no-cache libstdc++ openssl ncurses-libs
WORKDIR /app
ENV MIX_ENV=prod HOST=0.0.0.0 PORT=4180 PACK_DIR=/data
COPY --from=build /app /app
COPY --from=build /root/.mix /root/.mix
EXPOSE 4180
# Persistent multipack root must be mounted at /data
CMD ["mix", "run", "--no-halt"]
