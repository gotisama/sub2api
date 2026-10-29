package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type issuedKeyRepo struct {
	service.APIKeyRepository
	keys []*service.APIKey
}

func (r *issuedKeyRepo) Create(_ context.Context, key *service.APIKey) error {
	key.ID = int64(len(r.keys) + 1)
	r.keys = append(r.keys, key)
	return nil
}

type issuedKeyUsers struct{ service.UserRepository }

func (issuedKeyUsers) GetByID(_ context.Context, id int64) (*service.User, error) {
	if id == 999 {
		return nil, service.ErrUserNotFound
	}
	return &service.User{ID: id, Status: service.StatusActive}, nil
}

type issuedKeyGroups struct{ service.GroupRepository }

func (issuedKeyGroups) GetByID(_ context.Context, id int64) (*service.Group, error) {
	return &service.Group{ID: id, Status: service.StatusActive, IsExclusive: true}, nil
}

func issuedKeyRouter(t *testing.T, role string) (*gin.Engine, *issuedKeyRepo) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	service.SetDefaultIdempotencyCoordinator(service.NewIdempotencyCoordinator(newUserMemoryIdempotencyRepoStub(), service.DefaultIdempotencyConfig()))
	t.Cleanup(func() { service.SetDefaultIdempotencyCoordinator(nil) })
	repo := &issuedKeyRepo{}
	svc := service.NewAPIKeyService(repo, issuedKeyUsers{}, issuedKeyGroups{}, nil, nil, nil, &config.Config{})
	h := NewAPIKeyHandler(svc)
	r := gin.New()
	if role != "" {
		r.Use(withUserSubject(1))
		r.Use(func(c *gin.Context) { c.Set(string(middleware.ContextKeyUserRole), role); c.Next() })
	}
	r.POST("/admin/users/:id/api-keys", h.CreateForUser)
	return r, repo
}
func issueRequest(r *gin.Engine, id, body string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/admin/users/"+id+"/api-keys", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "issue-target-user-unique-key")
	r.ServeHTTP(w, req)
	return w
}
func TestAdminUserKeyOwnershipAndReplay(t *testing.T) {
	r, repo := issuedKeyRouter(t, service.RoleAdmin)
	body := `{"name":"work","quota":12,"rate_limit_1d":3,"expires_in_days":7}`
	first := issueRequest(r, "42", body)
	require.Equal(t, 200, first.Code, first.Body.String())
	require.Len(t, repo.keys, 1)
	require.Equal(t, int64(42), repo.keys[0].UserID)
	require.Equal(t, 12.0, repo.keys[0].Quota)
	require.Equal(t, 3.0, repo.keys[0].RateLimit1d)
	require.NotNil(t, repo.keys[0].ExpiresAt)
	second := issueRequest(r, "42", body)
	require.Equal(t, 200, second.Code)
	require.Equal(t, "true", second.Header().Get("X-Idempotency-Replayed"))
	require.Len(t, repo.keys, 1)
	var a, b map[string]any
	require.NoError(t, json.Unmarshal(first.Body.Bytes(), &a))
	require.NoError(t, json.Unmarshal(second.Body.Bytes(), &b))
	require.Equal(t, a, b)
	// Same administrator and idempotency key must never replay another owner's secret.
	other := issueRequest(r, "43", body)
	require.Equal(t, http.StatusConflict, other.Code)
	require.Len(t, repo.keys, 1)
}
func TestAdminUserKeyAuthorizationAndValidation(t *testing.T) {
	for _, tc := range []struct {
		name, role, id, body string
		status               int
	}{
		{"anonymous", "", "42", `{"name":"work"}`, 401},
		{"ordinary user", "user", "42", `{"name":"work"}`, 403},
		{"invalid id", "admin", "0", `{"name":"work"}`, 400},
		{"missing user", "admin", "999", `{"name":"work"}`, 404},
		{"blank name", "admin", "42", `{"name":"   "}`, 400},
		{"negative quota", "admin", "42", `{"name":"work","quota":-1}`, 400},
		{"group denied", "admin", "42", `{"name":"work","group_id":7}`, 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r, repo := issuedKeyRouter(t, tc.role)
			w := issueRequest(r, tc.id, tc.body)
			require.Equal(t, tc.status, w.Code, w.Body.String())
			require.Empty(t, repo.keys)
		})
	}
}
